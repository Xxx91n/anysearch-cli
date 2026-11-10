// PROTOTYPE — real-provider two-call run through the production `ans chat` path.
// A local logging proxy forwards to the configured OpenAI-compatible endpoint
// and records, per request: message roles/count/chars, whether the prompt is a
// summarization call, the last user text, and the provider-reported usage
// (including cache read). No headers or keys are logged.
//
// Uses a temporary domain with a deliberately low watermark so compression
// fires on a small conversation. The production watermark default is 128000
// (or a >=50000 absolute); the lowered value changes WHEN it triggers, not the
// summary-append behaviour under test.
//
// Run: node prototype/memory-wiring/probe-real.mjs

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

const TEMP = "D:/Windows/Temp/anysearch-probe-real";
if (existsSync(TEMP)) rmSync(TEMP, { recursive: true, force: true });
mkdirSync(join(TEMP, "domains"), { recursive: true });
writeFileSync(join(TEMP, "domains", "probe.toml"), [
  'name = "probe"',
  'description = "memory wiring prototype probe"',
  "",
  "[sources]",
  'enabled = ["tavily", "exa"]',
  "",
  "[rag]",
  'adapter = "none"',
  "",
  "[hooks]",
  'toolWhitelist = ["search"]',
  "",
  "[compaction]",
  "lowWatermark = { fraction = 0.01 }",
  "reuseCap = 3",
  "",
].join("\n"));

const upstream = process.env.ANS_LLM_BASE_URL;
if (!upstream) throw new Error("ANS_LLM_BASE_URL must be set");

function normalizeUsage(u) {
  if (!u) return null;
  return {
    input: u.prompt_tokens ?? u.input_tokens ?? 0,
    output: u.completion_tokens ?? u.output_tokens ?? 0,
    cacheRead: u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0,
    total: u.total_tokens ?? 0,
  };
}
function extractUsage(text) {
  let usage = null;
  const tryObj = (s) => { try { const o = JSON.parse(s); if (o && typeof o === "object" && o.usage) usage = o.usage; } catch { /* skip */ } };
  if (/^\s*data:/m.test(text)) {
    for (const line of text.split(/\r?\n/)) {
      const m = /^data:\s*(.*)$/.exec(line);
      if (m && m[1] !== "[DONE]") tryObj(m[1]);
    }
  } else tryObj(text);
  return usage;
}

const rows = [];
function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => c.text || "").join("");
  return "";
}

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  let j = null;
  try { j = JSON.parse(body.toString("utf8")); } catch { /* non-JSON */ }
  const messages = j?.messages || [];
  const system = messages.find((m) => m.role === "system");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastUserText = textOf(lastUser?.content);
  const row = {
    ts: Date.now(),
    path: req.url,
    model: j?.model ?? null,
    stream: !!j?.stream,
    messageCount: messages.length,
    roles: messages.map((m) => m.role),
    chars: messages.reduce((n, m) => n + textOf(m.content).length, 0),
    isSummary: /context summarization assistant/i.test(textOf(system?.content)),
    hasSessionMemoryTag: lastUserText.includes("[Session Memory]"),
    hasResearchRecallTag: lastUserText.includes("[Research Recall]"),
    lastUserChars: lastUserText.length,
    lastUserTail: lastUserText.slice(-160),
    toolResultsInPrompt: messages.filter((m) => m.role === "tool" || m.role === "toolResult").length,
    status: 0,
    usage: null,
    outputTail: "",
  };
  const started = Date.now();
  let captured = "";
  try {
    const u = new URL(upstream);
    const target = u.origin + req.url;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers["content-length"];
    delete headers.connection;
    const up = await fetch(target, { method: req.method, headers, body: body.length ? body : undefined, duplex: "half" });
    row.status = up.status;
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "text/event-stream" });
    if (up.body) {
      const dec = new TextDecoder();
      for await (const chunk of up.body) {
        res.write(chunk);
        if (captured.length < 2_000_000) captured += dec.decode(chunk, { stream: true });
      }
    }
    res.end();
  } catch (e) {
    row.status = 502;
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "probe upstream error: " + String(e?.message ?? e) } }));
  }
  row.ms = Date.now() - started;
  row.usage = normalizeUsage(extractUsage(captured));
  row.outputTail = captured.slice(-80).replace(/\s+/g, " ");
  rows.push(row);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const upstreamUrl = new URL(upstream);
const localBase = "http://127.0.0.1:" + port + upstreamUrl.pathname.replace(/\/$/, "");

const env = {
  ...process.env,
  ANS_LLM_BASE_URL: localBase,
  // Declare the real window this endpoint has; without it the {fraction}
  // watermark intentionally falls back to the absolute 128000 and never fires
  // on this small conversation.
  ANS_LLM_CONTEXT_WINDOW: "100000",
  ANS_DOMAINS_DIR: join(TEMP, "domains"),
  ANS_DOMAIN: "probe",
  ANS_DB_PATH: join(TEMP, "probe.db"),
  ANS_SESSION_ID: "probe-session",
  ANS_NO_INTERACTIVE: "1",
};

function runChat(query) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const p = spawn(process.execPath, ["apps/cli/dist/index.js", "chat", query], { env, cwd: process.cwd() });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, ms: Date.now() - startedAt, startedAt, out, err }));
  });
}

const call1 = await runChat("Search the web for anysearch-cli memory pipeline rolling summary, then answer in three short sentences.");
await new Promise((r) => setTimeout(r, 1000));
const call2 = await runChat("Without searching again, tell me what you remember from the previous answer in this session.");
await new Promise((r) => setTimeout(r, 1000));

const db = new Database(join(TEMP, "probe.db"), { readonly: true });
const anchors = db.prepare("SELECT anchor_type, length(payload) AS chars, created_at FROM resume_anchors ORDER BY id").all();
const sessions = db.prepare("SELECT id, domain, created_at FROM sessions ORDER BY id").all();
db.close();

server.close();
await new Promise((r) => setTimeout(r, 200));

call1.requests = rows.filter((r) => r.ts < call2.startedAt);
call2.requests = rows.filter((r) => r.ts >= call2.startedAt);

const result = {
  generatedAt: new Date().toISOString(),
  inputSource: "production `ans chat` from apps/cli/dist, real provider through a local logging proxy, temporary DB and domain",
  upstreamHost: upstreamUrl.host,
  upstreamPath: upstreamUrl.pathname,
  loweredWatermark: "compaction.lowWatermark = { fraction = 0.01 }; production default is 128000/>=50000",
  sessionId: "probe-session",
  calls: [call1, call2].map((c) => ({
    code: c.code,
    ms: c.ms,
    stdoutTail: c.out.slice(-400),
    stderrTail: c.err.slice(-400),
    requests: c.requests,
  })),
  anchors,
  sessions,
};
writeFileSync(join(OUT, "probe-real.json"), JSON.stringify(result, null, 2));

for (const [i, c] of result.calls.entries()) {
  console.log("\n=== call " + (i + 1) + " exit=" + c.code + " ms=" + c.ms + " requests=" + c.requests.length + " ===");
  for (const r of c.requests) {
    console.log(JSON.stringify({
      summary: r.isSummary,
      msgs: r.messageCount,
      roles: r.roles,
      chars: r.chars,
      sessionMemory: r.hasSessionMemoryTag,
      recall: r.hasResearchRecallTag,
      usage: r.usage,
      ms: r.ms,
      lastUserTail: r.lastUserTail,
    }));
  }
  console.log("stdout tail: " + c.stdoutTail.replace(/\n/g, " | "));
  console.log("stderr tail: " + c.stderrTail.replace(/\n/g, " | "));
}
console.log("\nanchors " + JSON.stringify(anchors));
console.log("sessions " + JSON.stringify(sessions));
console.log("wrote " + join(OUT, "probe-real.json"));
