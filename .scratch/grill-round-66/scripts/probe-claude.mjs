// R66 T1/T2/T4 probe runner — one Claude Code headless probe, stream-json transcript + verdict.
// Ported from R65 scripts/probe.mjs (codebuddy) -> claude CLI flags per next-round.md.
// Usage: node probe-claude.mjs <label> "<prompt>" [--nomcp] [--maxturns N] [--cwd DIR] [--settings FILE] [--plugindir DIR] [--mcpconfig FILE] [--timeout SEC]
// - Injects User-level env keys into the child process (values NEVER printed/logged).
// - Transcript -> <evidence>/<label>.stream.jsonl ; stderr -> <label>.debug.log
// - Prints compact verdict JSON: mcp servers, ans tool calls, hook events, result tail, db delta.
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const label = process.argv[2];
const prompt = process.argv[3];
const rawFlags = new Set(process.argv.slice(4).filter(a => a.startsWith('--')));
const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };

const E2E = resolve(arg('cwd', 'D:/Aworker/e2e-r66-claude'));
const EVID = 'D:/Aworker/anysearch-cli/.scratch/grill-round-66/evidence';
mkdirSync(EVID, { recursive: true });
const MAXTURNS = arg('maxturns', '6');
const TIMEOUT = Number(arg('timeout', '300')) * 1000;
const NOMCP = rawFlags.has('--nomcp');
const SETTINGS = arg('settings', null);
const PLUGINDIR = arg('plugindir', null);
const MCPCONFIG = arg('mcpconfig', 'mcp.json');
const ALLOWED = arg('allowedtools', null);
const NOSKIP = rawFlags.has('--noskip');

// --- env injection: read User-scope vars via powershell, merge into child env ---
const KEYS = ['ANYSEARCH_API_KEY', 'ANYSEARCH_ENDPOINT', 'ANS_LLM_BASE_URL', 'ANS_LLM_API', 'ANS_LLM_API_KEY', 'EXA_API_KEY', 'TAVILY_API_KEY', 'ANS_LLM_PROVIDER', 'ANS_LLM_MODEL'];
const env = { ...process.env };
for (const k of KEYS) {
  if (env[k]) continue;
  try {
    const v = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'' + k + '\',\'User\')"', { encoding: 'utf8' }).trim();
    if (v) env[k] = v;
  } catch { }
}
env.ANS_DOMAIN = env.ANS_DOMAIN || 'docs';

// --- project-index.db row delta (better-sqlite3 via repo install) ---
const dbPath = join(E2E, '.anysearch', 'project-index.db');
let dbRows = () => -1;
try {
  const req = createRequire('D:/Aworker/anysearch-cli/apps/plugin/package.json');
  const Database = req('better-sqlite3');
  dbRows = () => {
    try { const db = new Database(dbPath, { readonly: true }); const n = db.prepare('SELECT COUNT(*) c FROM project_index').get().c; db.close(); return n; }
    catch { return -1; }
  };
} catch { }
const rowsBefore = dbRows();

const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose',
  '--max-turns', MAXTURNS];
if (!NOSKIP) args.push('--dangerously-skip-permissions');
if (ALLOWED) args.push('--allowedTools', ALLOWED);
if (PLUGINDIR) args.push('--plugin-dir', PLUGINDIR);
if (!NOMCP) args.push('--mcp-config', MCPCONFIG, '--strict-mcp-config');
if (SETTINGS) args.push('--settings', SETTINGS);

const transcriptPath = join(EVID, label + '.stream.jsonl');
const debugPath = join(EVID, label + '.debug.log');
writeFileSync(transcriptPath, '');
writeFileSync(debugPath, '');

const CLAUDE_EXE = 'C:/Users/Administrator/.local/bin/claude.exe';
const child = spawn(CLAUDE_EXE, args, { cwd: E2E, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '', dbg = '';
child.stdout.on('data', d => { out += d; appendFileSync(transcriptPath, d); });
child.stderr.on('data', d => { dbg += d; appendFileSync(debugPath, d); });

const summary = { label, ok: false, mcpServers: null, ansToolsListed: [], toolCalls: [], hookEvents: [], abstain: null, resultTail: '', errors: [], rowsBefore, rowsAfter: null, costUsd: null, numTurns: null };

child.on('close', (code) => {
  summary.exitCode = code;
  summary.rowsAfter = dbRows();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type === 'system' && m.subtype === 'init') {
      summary.mcpServers = m.mcp_servers || [];
      summary.ansToolsListed = (m.tools || []).filter(t => /anysearch|search_web|ans_chat|research_web|recall_memory|query_knowledge/i.test(t));
    }
    if (m.type === 'system' && (m.subtype === 'hook_started' || m.subtype === 'hook_response')) {
      summary.hookEvents.push({ sub: m.subtype, name: m.hook_name, event: m.hook_event, outTail: String(m.stdout || m.output || '').slice(-160) });
    }
    if (m.type === 'assistant' && m.message?.content) {
      for (const c of m.message.content) {
        if (c.type === 'tool_use') summary.toolCalls.push({ name: c.name, input: JSON.stringify(c.input).slice(0, 160) });
        if (c.type === 'text') summary.resultTail = c.text.slice(-600);
      }
    }
    if (m.type === 'result') {
      summary.ok = !m.is_error;
      summary.costUsd = m.total_cost_usd ?? null;
      summary.numTurns = m.num_turns ?? null;
      if (m.errors?.length) summary.errors = m.errors;
      if (m.result) summary.resultTail = String(m.result).slice(-600);
    }
  }
  summary.abstain = /"abstain"\s*:\s*true|abstain/i.test(out) ? /"abstain"\s*:\s*true/.test(out) : null;
  console.log(JSON.stringify(summary, null, 1));
});
setTimeout(() => { try { child.kill(); } catch { } summary.errors.push('timeout ' + (TIMEOUT / 1000) + 's'); console.log(JSON.stringify(summary, null, 1)); process.exit(2); }, TIMEOUT);
