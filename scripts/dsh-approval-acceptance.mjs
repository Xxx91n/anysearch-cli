#!/usr/bin/env node
// Real host acceptance for the dsh approval channel.
//
// What this proves: our dsh plugin answers "ask" when a tool argument carries a
// URL the policy cannot vouch for. The host then asks its composed approval
// answerers, and that answer becomes the tool decision. This script checks the
// four outcomes a user can produce on the interactive path, plus the plain
// fail-closed answer when no approval channel exists:
//
//   allow once  -> the tool really runs
//   reject      -> the model gets a refusal instead of a result
//   cancel      -> the turn aborts before dispatch
//   no channel  -> headless denies with its own "no approval channel" reason
//
// The first three need the browser; the fourth is headless by necessity, because
// a headless profile composes no answerer.
//
// Everything happens in one temporary directory: DSH_HOME, the workspace, both
// local servers, and their stores. Nothing under the real home directory is
// touched, and the directory is deleted on exit unless --keep is passed.
//
// Run against whatever dsh is on PATH. There is no pinned version here.
//
// Env:
//   ANS_LLM_BASE_URL / ANS_LLM_API_KEY / ANS_LLM_MODEL   model route (required)
//   DSH_BIN                                              default: dsh
//   ANS_ACCEPTANCE_PLAYWRIGHT                            module id or directory
//   ANS_ACCEPTANCE_BROWSER                               browser executable
//
// Usage:
//   node scripts/dsh-approval-acceptance.mjs [--keep]

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import zlib from "node:zlib";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEEP = process.argv.includes("--keep");
const results = [];
const children = [];
let temp = "";

function recordPass(name, detail) {
  results.push({ name, detail });
  console.log(`PASS  ${name} — ${detail}`);
}

function must(cond, message) {
  if (!cond) throw new Error(message);
}

// Windows starts .cmd shims through cmd.exe. Quote every argument that could
// carry a space so the same call shape works on both platforms.
function shellLine(parts) {
  return parts
    .map((p) => (/[\s"&|<>^]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p))
    .join(" ");
}

function run(cmd, args, options = {}) {
  const line = shellLine([cmd, ...args]);
  const res = spawnSync(line, {
    cwd: options.cwd ?? REPO,
    encoding: "utf8",
    shell: true,
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: options.timeout ?? 600_000,
  });
  if (res.error) throw res.error;
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function runOrFail(cmd, args, options = {}) {
  const res = run(cmd, args, options);
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${res.status}\n${res.stdout}\n${res.stderr}`.trim());
  }
  return res;
}

function start(cmd, args, options = {}) {
  const line = shellLine([cmd, ...args]);
  const child = spawn(line, {
    cwd: options.cwd ?? REPO,
    env: { ...process.env, ...(options.env ?? {}) },
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const logs = [];
  child.stdout.on("data", (d) => logs.push(Buffer.from(d).toString("utf8")));
  child.stderr.on("data", (d) => logs.push(Buffer.from(d).toString("utf8")));
  child.logText = () => logs.join("");
  children.push(child);
  return child;
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    try { child.kill("SIGKILL"); } catch {}
  }
}

function freePort() {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

async function waitFor(label, predicate, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(500);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadPlaywright() {
  const request = createRequire(import.meta.url);
  const candidates = [];
  const env = process.env.ANS_ACCEPTANCE_PLAYWRIGHT;
  if (env) {
    candidates.push(env, join(env, "playwright-core"), join(env, "playwright"));
    candidates.push(join(env, "node_modules", "playwright-core"), join(env, "node_modules", "playwright"));
  }
  candidates.push("playwright-core", "playwright");
  for (const id of candidates) {
    try { return request(id); } catch {}
  }
  throw new Error(
    "no Playwright module found. Set ANS_ACCEPTANCE_PLAYWRIGHT to an installed playwright-core/playwright module or its directory.",
  );
}

// Session logs are zstd-compressed JSONL. Node 22.15+ decodes them directly.
function readSessionEvents(file) {
  const raw = zlib.zstdDecompressSync(readFileSync(file)).toString("utf8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

async function sessionDirs(dshHome) {
  const root = join(dshHome, "sessions");
  if (!existsSync(root)) return [];
  const dirs = [];
  for (const workspace of await readdir(root)) {
    const byWorkspace = join(root, workspace);
    for (const session of await readdir(byWorkspace)) {
      dirs.push(join(byWorkspace, session));
    }
  }
  return dirs;
}

async function waitForNewSession(before, dshHome, predicate, timeoutMs = 60_000) {
  return waitFor(
    "a new session log with the expected approval events",
    async () => {
      for (const dir of await sessionDirs(dshHome)) {
        if (before.has(dir)) continue;
        const file = join(dir, "session.v4.jsonl.zstd");
        if (!existsSync(file)) continue;
        let events;
        try { events = readSessionEvents(file); } catch { continue; }
        const found = predicate(events);
        if (found) return { dir, events, found };
      }
      return null;
    },
    timeoutMs,
  );
}

function approvalPair(events) {
  const asked = events.filter((e) => e.type === "approval/asked");
  const decided = events.filter((e) => e.type === "approval/decided");
  const toolResults = events.filter((e) => e.type === "tool/result");
  return { asked, decided, results: toolResults };
}

function toolText(event) {
  const content = event?.data?.message?.content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (typeof c.text === "string" ? c.text : "")).join("\n");
}

function matchPair(pair) {
  for (const a of pair.decided) {
    const ask = pair.asked.find((q) => q.data.id === a.data.id);
    if (ask) return { ask, decided: a };
  }
  return null;
}

function assertAsk(ask) {
  must(ask.data.toolName === "ans_search_web", `expected tool ans_search_web, saw ${ask.data.toolName}`);
  must(
    /URL not on allowlist/.test(ask.data.reason ?? ""),
    `approval reason does not show the URL policy: ${ask.data.reason}`,
  );
}

function findToolResult(pair, callId) {
  return pair.results.find((r) => r.data.message?.toolCallId === callId);
}

// Reject, cancel and the headless refusal share one shape: a decision, the
// matching tool result, and a model-facing error. Only the outcome and the
// expected wording differ.
async function waitOutcome(before, dshHome, outcome, label) {
  const session = await waitForNewSession(before, dshHome, (events) => {
    const pair = approvalPair(events);
    const matched = matchPair(pair);
    if (!matched || matched.decided.data.outcome !== outcome) return null;
    const tool = findToolResult(pair, matched.ask.data.callId);
    return tool ? { matched, tool } : null;
  });
  const { matched, tool } = session.found;
  assertAsk(matched.ask);
  const text = toolText(tool);
  must(tool?.data.message?.isError === true, `${label}: the call was not reported as an error`);
  return text;
}

const WEB_PROMPT =
  "调用 ans_search_web，搜索 https://unknown.example/x 这个网址里的内容。必须调用这个工具，不要直接回答。";

// The host UI is localised. Match the Chinese wording first, then the English one.
const ALLOW = /允许一次|Allow once/i;
const REJECT = /拒绝|Reject/i;

async function composerReady(page) {
  return page.evaluate(() => {
    const el = document.querySelector('div[contenteditable="true"], textarea');
    if (!el) return false;
    if (el.closest("[inert]")) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

async function dismissPreview(page) {
  // The preview notice can render before or after the composer. Keep closing it
  // until the composer is really clickable; a modal makes the page inert.
  for (let i = 0; i < 20; i += 1) {
    const continueButton = page.getByRole("button", { name: /继续|Continue/i });
    if ((await continueButton.count().catch(() => 0)) > 0) {
      await continueButton.first().click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(700);
    }
    if (await composerReady(page)) return;
    await page.waitForTimeout(500);
  }
  throw new Error("the composer never became usable; a modal may still be blocking the page");
}

async function sendPrompt(page, token, port) {
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  // The first page load also creates the default workspace. Give the Documents
  // lookup its window before the composer exists.
  await page
    .locator('div[contenteditable="true"], textarea')
    .first()
    .waitFor({ state: "attached", timeout: 60_000 });
  await dismissPreview(page);
  await page.locator('div[contenteditable="true"], textarea').first().click();
  await page.keyboard.type(WEB_PROMPT);
  await page.getByRole("button", { name: /发送消息|Send message/i }).click().catch(async () => {
    await page.keyboard.press("Enter");
  });
}

async function runWebScenario(kind, ctx) {
  const { chromium, executablePath, token, port, dshHome } = ctx;
  const before = new Set(await sessionDirs(dshHome));
  const browserInstance = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await browserInstance.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await sendPrompt(page, token, port);
    if (kind === "allow") {
      await page.getByRole("button", { name: ALLOW }).waitFor({ state: "visible", timeout: 90_000 });
      await page.getByRole("button", { name: ALLOW }).click();
      const session = await waitForNewSession(
        before,
        dshHome,
        (events) => {
          const pair = approvalPair(events);
          const matched = matchPair(pair);
          if (!matched) return null;
          const end = events.find((e) => e.type === "turn/end");
          const tool = findToolResult(pair, matched.ask.data.callId);
          return end && tool ? { matched, end, tool } : null;
        },
        120_000,
      );
      const { matched, tool } = session.found;
      assertAsk(matched.ask);
      const failed = session.found.end.data.reason?.kind === "aborted";
      const text = toolText(tool);
      const realRun = tool && tool.data.message?.isError !== true && text.length > 50;
      must(!failed, "allow scenario: the turn aborted instead of finishing");
      must(matched.decided.data.outcome === "allowed-once", `allow scenario: outcome was ${matched.decided.data.outcome}`);
      must(realRun, "allow scenario: the tool call did not return real search content");
      return `allowed-once, tool ran (${text.length} chars back)`;
    }

    if (kind === "reject") {
      await page.getByRole("button", { name: REJECT }).waitFor({ state: "visible", timeout: 90_000 });
      await page.getByRole("button", { name: REJECT }).click();
      const text = await waitOutcome(before, dshHome, "rejected", "reject scenario");
      must(/rejected tool/i.test(text), `reject scenario: unexpected model-facing text: ${text.slice(0, 120)}`);
      return `rejected, the model saw a refusal ("${text.slice(0, 80)}")`;
    }

    if (kind === "cancel") {
      await page.getByRole("button", { name: REJECT }).waitFor({ state: "visible", timeout: 90_000 });
      const clicked = await page.evaluate(() => {
        const stop = document.querySelector('button[aria-label="停止生成"], button[aria-label="Stop generating"]');
        if (!stop) return false;
        stop.click();
        return true;
      });
      must(clicked, "cancel scenario: the stop control was not on the page");
      const text = await waitOutcome(before, dshHome, "cancelled", "cancel scenario");
      must(/aborted before dispatch/i.test(text), `cancel scenario: unexpected model-facing text: ${text.slice(0, 120)}`);
      return `cancelled, the call stopped before dispatch ("${text.slice(0, 80)}")`;
    }

    throw new Error(`unknown web scenario: ${kind}`);
  } finally {
    await browserInstance.close().catch(() => {});
  }
}

async function runHeadlessScenario(ctx) {
  const { profile, patch, dshHome, dshBin, env, cwd } = ctx;
  const before = new Set(await sessionDirs(dshHome));
  const runRes = run(dshBin, ["--profile", profile, "--patch", patch, WEB_PROMPT], {
    cwd,
    env,
    timeout: 240_000,
  });
  must(runRes.status === 0, `headless run exited ${runRes.status}:\n${runRes.stdout}\n${runRes.stderr}`.trim());
  const text = await waitOutcome(before, dshHome, "unavailable", "headless scenario");
  must(
    /no approval channel is available/i.test(text),
    `headless scenario: unexpected model-facing text: ${text.slice(0, 120)}`,
  );
  return `unavailable, the ask was denied with "${text.slice(0, 90)}"`;
}

async function main() {
  must(zlib.zstdDecompressSync, "this Node cannot decode zstd; Node 22.15+ is required");

  const dshBin = process.env.DSH_BIN || "dsh";
  const version = run(dshBin, ["--version"]);
  must(version.status === 0, `cannot run ${dshBin} --version:\n${version.stderr}`);
  recordPass("dsh present", `${dshBin} ${version.stdout.trim()} (no pin checked)`);

  const policyDist = join(REPO, "apps", "plugin", "dist", "server", "index.cjs");
  const mcpDist = join(REPO, "apps", "mcp", "dist", "index.cjs");
  if (!existsSync(policyDist) || !existsSync(mcpDist)) {
    console.log("building the local apps the acceptance needs...");
    runOrFail("pnpm", ["-C", "apps/plugin", "build"]);
    runOrFail("pnpm", ["-C", "apps/mcp", "build"]);
  }
  must(existsSync(policyDist), "apps/plugin/dist/server/index.cjs is still missing after the build");
  must(existsSync(mcpDist), "apps/mcp/dist/index.cjs is still missing after the build");

  temp = await mkdtemp(join(tmpdir(), "ans-dsh-approval-"));
  const dshHome = join(temp, "dsh-home");
  const documents = join(temp, "documents");
  const ansHome = join(temp, "ans-home");
  const domains = join(temp, "domains");
  for (const dir of [dshHome, documents, ansHome, domains]) await mkdir(dir, { recursive: true });

  const token = createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 32);

  // lib/ is gitignored, so a fresh checkout has no entry file. Build from
  // source before packing; otherwise the tarball loads no plugin at all.
  console.log("building apps/dsh-plugin from source before packing...");
  runOrFail("pnpm", ["-C", "apps/dsh-plugin", "build"]);
  runOrFail("pnpm", ["-C", "apps/dsh-plugin", "pack", "--pack-destination", temp]);
  const tarballs = (await readdir(temp)).filter((f) => f.endsWith(".tgz"));
  must(tarballs.length === 1, `expected one packed tarball, found ${tarballs.length}`);
  const tarball = join(temp, tarballs[0]);
  console.log(`packed ${tarballs[0]}`);

  const dshEnv = {
    DSH_HOME: dshHome,
    ANS_SERVER_URL: "",
    ANS_SERVER_TOKEN: token,
    ANS_MCP_URL: "",
    ANS_DOMAINS_DIR: domains,
    ANS_DB_PATH: join(ansHome, "anysearch.db"),
  };

  for (const [profile, template] of [
    ["accept-web", "web"],
    ["accept-headless", "headless"],
  ]) {
    runOrFail(dshBin, ["--profile", profile, "--from-default-profile", template, "--dump-config"], {
      cwd: temp,
      env: dshEnv,
    });
    runOrFail(dshBin, ["plugin", "--profile", profile, "add", tarball], { cwd: temp, env: dshEnv });
  }

  const patch = join(temp, "model-patch.yml");
  await writeFile(
    patch,
    [
      "- id: llm-pi-ai",
      "  config:",
      "    providers:",
      "      ans-gateway:",
      "        api: openai-completions",
      `        baseURL: ${JSON.stringify(process.env.ANS_LLM_BASE_URL)}`,
      "        apiKeyEnv: ANS_LLM_API_KEY",
      "        models:",
      `          - id: ${JSON.stringify(process.env.ANS_LLM_MODEL)}`,
      "            contextWindow: 200000",
      "- id: agent-default-model",
      "  config:",
      "    provider: ans-gateway",
      `    model: ${JSON.stringify(process.env.ANS_LLM_MODEL)}`,
      "- id: workspace-controller",
      "  config:",
      `    documentsDirectory: ${JSON.stringify(documents)}`,
      // Skip the product preview notice. A sandbox page should start at the
      // composer; the version string is the current one the client compares.
      "- id: ui-settings-general",
      "  config:",
      '    welcomeNoticeVersion: "2026-09-28.1"',
      "",
    ].join("\n"),
  );

  const policyPort = await freePort();
  const mcpPort = await freePort();
  const webPort = await freePort();

  start("node", [policyDist], {
    cwd: temp,
    env: {
      ANS_SERVER_TOKEN: token,
      ANS_SERVER_PORT: String(policyPort),
      ANS_PROJECT_DB: join(ansHome, "project-index.db"),
      ANS_DB_PATH: join(ansHome, "anysearch.db"),
      ANS_DOMAINS_DIR: domains,
    },
  });
  await waitFor("the policy server", async () => {
    const res = await fetch(`http://127.0.0.1:${policyPort}/health`, {
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => null);
    return res?.status === 200;
  });
  recordPass("policy server", `127.0.0.1:${policyPort}, empty allowlist so any URL asks`);

  start("node", [mcpDist, "--transport", "http", "--port", String(mcpPort)], {
    cwd: temp,
    env: { ANS_DB_PATH: join(ansHome, "anysearch.db"), ANS_DOMAINS_DIR: domains },
  });
  await waitFor("the ans-mcp server", async () => (await sessionIsListening(mcpPort)) === true);
  recordPass("ans-mcp server", `127.0.0.1:${mcpPort}, tool calls have a real destination`);

  const webEnv = {
    ...dshEnv,
    ANS_SERVER_URL: `http://127.0.0.1:${policyPort}`,
    ANS_MCP_URL: `http://127.0.0.1:${mcpPort}`,
  };

  const web = start(dshBin, ["--profile", "accept-web", "--patch", patch, "--no-open", "--port", String(webPort)], {
    cwd: temp,
    env: webEnv,
  });
  const url = await waitFor("the dsh web URL", async () => {
    const match = web.logText().match(/dsh web: http:\/\/127\.0\.0\.1:[^\s]+/);
    return match ? match[0] : null;
  }, 120_000);
  const tokenMatch = url.match(/token=([^&\s]+)/);
  must(tokenMatch, `could not read the web token from: ${url}`);
  recordPass("dsh web booted", `sandbox profile on port ${webPort}`);

  const { chromium } = loadPlaywright();
  const executablePath = process.env.ANS_ACCEPTANCE_BROWSER;
  const ctx = { chromium, executablePath, token: tokenMatch[1], port: webPort, dshHome };

  for (const [kind, title] of [
    ["allow", "approval: allow once"],
    ["reject", "approval: reject"],
    ["cancel", "approval: cancel by stopping the turn"],
  ]) {
    recordPass(title, await runWebScenario(kind, ctx));
  }

  recordPass(
    "approval: no channel in headless",
    await runHeadlessScenario({
      profile: "accept-headless",
      patch,
      dshHome,
      dshBin,
      env: webEnv,
      cwd: temp,
    }),
  );

  console.log("");
  console.log(`acceptance complete: ${results.length} checks, all passed`);
}

function sessionIsListening(port) {
  return new Promise((res) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); res(true); });
    socket.once("error", () => res(false));
    socket.setTimeout(1000, () => { socket.destroy(); res(false); });
  });
}

let exitCode = 0;
let cleanedUp = false;

async function removeSandbox() {
  // Windows can hold a handle for a moment after a child dies. Retry a few
  // times instead of reporting a clean run over a leftover directory.
  for (let i = 0; i < 6; i += 1) {
    try {
      await rm(temp, { recursive: true, force: true });
      return true;
    } catch {
      await sleep(400);
    }
  }
  return false;
}

async function cleanUp() {
  if (cleanedUp) return;
  cleanedUp = true;
  for (const child of children) stop(child);
  if (!temp) return;
  if (KEEP) {
    console.log(`kept sandbox at ${temp}`);
    return;
  }
  if (!(await removeSandbox())) {
    console.error(`could not delete the sandbox at ${temp}; remove it by hand`);
    exitCode = 1;
  }
}

// Ctrl-C would otherwise skip cleanup and leave servers and the sandbox behind.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void cleanUp().then(() => process.exit(130));
  });
}

try {
  requireEnv();
  await main();
} catch (error) {
  exitCode = 1;
  console.error("");
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await cleanUp();
  process.exitCode = exitCode;
}

function requireEnv() {
  for (const key of ["ANS_LLM_BASE_URL", "ANS_LLM_API_KEY", "ANS_LLM_MODEL"]) {
    must(process.env[key], `${key} is not set; the acceptance needs a working model route`);
  }
}
