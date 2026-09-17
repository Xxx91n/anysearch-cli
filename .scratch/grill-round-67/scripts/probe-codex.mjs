// R67 probe runner — one Codex CLI headless probe, JSONL transcript + verdict.
// Usage: node probe-codex.mjs <label> "<prompt>" [--cwd DIR] [--timeout SEC] [--xargs "[argv]"] [--marker WORD]
import { spawn, execSync } from "node:child_process";
import { writeFileSync, appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const label = process.argv[2];
const prompt = process.argv[3];
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; };
const E2E = resolve(arg("cwd", "D:/Aworker/e2e-r67-codex"));
const EVID = "D:/Aworker/anysearch-cli/.scratch/grill-round-67/evidence";
mkdirSync(EVID, { recursive: true });
const TIMEOUT = Number(arg("timeout", "240")) * 1000;
const XARGS = JSON.parse(arg("xargs", "[]").trim() || "[]").concat(arg("xargs-file", null) ? JSON.parse(readFileSync(arg("xargs-file"), "utf8")) : []);
const MARKER = arg("marker", null);

const KEYS = ["ANYSEARCH_API_KEY", "ANYSEARCH_ENDPOINT", "ANS_LLM_BASE_URL", "ANS_LLM_API", "ANS_LLM_API_KEY", "EXA_API_KEY", "TAVILY_API_KEY", "ANS_LLM_PROVIDER", "ANS_LLM_MODEL"];
const env = { ...process.env };
const BS = String.fromCharCode(92);
for (const k of KEYS) {
  if (env[k]) continue;
  try {
    const out = execSync("reg query HKCU" + BS + "Environment /v " + k, { encoding: "utf8" });
    const m = out.match(/REG_SZ\s+(.+)/);
    if (m) env[k] = m[1].trim();
  } catch { }
}
env.ANS_DOMAIN = env.ANS_DOMAIN || "docs";
try { const t = readFileSync(E2E + "/.anysearch-cli/server-token-r67", "utf8").trim(); if (t) { env.ANS_SERVER_TOKEN = t; env.ANS_SERVER_URL = "http://127.0.0.1:33334"; } } catch { }

const tpath = join(EVID, label + ".stream.jsonl");
const dpath = join(EVID, label + ".debug.log");
writeFileSync(tpath, ""); writeFileSync(dpath, "");

const CODEXJS = "C:/Users/Administrator/AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js";
const child = spawn(process.execPath, [CODEXJS, "exec", prompt, "--json", "--ephemeral", "--skip-git-repo-check", ...XARGS],
  { cwd: E2E, env, stdio: ["ignore", "pipe", "pipe"], shell: false });
let out = "", dbg = "";
child.stdout.on("data", d => { out += d; appendFileSync(tpath, d); });
child.stderr.on("data", d => { dbg += d; appendFileSync(dpath, d); });

const timer = setTimeout(() => { try { child.kill(); } catch { } summary.errorItems.push("timeout " + TIMEOUT / 1000 + "s"); summary.stderrTail = dbg.slice(-400); console.log(JSON.stringify(summary, null, 1)); process.exit(2); }, TIMEOUT);
const summary = { label, ok: false, exitCode: null, agentTexts: [], errorItems: [], itemTypes: {}, mcpToolCalls: [], cmdExecs: [], markerInAgent: null, markerInStream: null, usage: null, stderrTail: "" };
child.on("close", code => {
  clearTimeout(timer);
  summary.exitCode = code;
  const NL = String.fromCharCode(10);
  for (const line of out.split(NL)) {
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type === "item.completed" && m.item) {
      const it = m.item;
      summary.itemTypes[it.type] = (summary.itemTypes[it.type] || 0) + 1;
      if (it.type === "agent_message") summary.agentTexts.push(it.text);
      if (it.type === "error") summary.errorItems.push(String(it.message).slice(0, 300));
      if (/mcp/i.test(it.type)) summary.mcpToolCalls.push({ t: it.type, head: JSON.stringify(it).slice(0, 220) });
      if (it.type === "command_execution") summary.cmdExecs.push({ cmd: String(it.command).slice(0, 160), exit: it.exit_code ?? it.status });
    }
    if (m.type === "turn.completed") { summary.ok = true; summary.usage = m.usage || null; }
    if (m.type === "turn.failed" || m.type === "error") summary.errorItems.push("TURN:" + JSON.stringify(m).slice(0, 300));
  }
  if (MARKER) {
    summary.markerInAgent = summary.agentTexts.join(NL).includes(MARKER);
    summary.markerInStream = out.includes(MARKER);
  }
  summary.stderrTail = dbg.slice(-400);
  console.log(JSON.stringify(summary, null, 1));
});
