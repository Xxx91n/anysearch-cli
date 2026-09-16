// R65 T2/T4 probe runner — one CodeBuddy headless probe, stream-json transcript + verdict.
// Usage: node probe.mjs <label> "<prompt>" [--nomcp] [--maxturns N] [--cwd DIR]
// - Injects User-level env keys into the child process (values NEVER printed/logged).
// - Transcript -> <evidence>/t2-<label>.stream.jsonl ; debug (-d hooks) -> t2-<label>.debug.log
// - Prints a compact verdict JSON: mcp servers seen, ans tool calls, result text tail, db delta.
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const label = process.argv[2];
const prompt = process.argv[3];
const flags = new Set(process.argv.slice(4).filter(a => a.startsWith('--')));
const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };

const E2E = resolve(arg('cwd', 'D:/Aworker/e2e-r65-codebuddy'));
const EVID = 'D:/Aworker/anysearch-cli/.scratch/grill-round-65/evidence';
mkdirSync(EVID, { recursive: true });
const MAXTURNS = arg('maxturns', '6');
const NOMCP = flags.has('--nomcp');

// --- env injection: read User-scope vars via powershell, merge into child env ---
const KEYS = ['ANYSEARCH_API_KEY', 'ANS_LLM_BASE_URL', 'ANS_LLM_API', 'ANS_LLM_API_KEY', 'EXA_API_KEY', 'TAVILY_API_KEY', 'ANS_LLM_PROVIDER', 'ANS_LLM_MODEL'];
const env = { ...process.env };
for (const k of KEYS) {
  if (env[k]) continue;
  try {
    const v = execSync(`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('${k}','User')"`, { encoding: 'utf8' }).trim();
    if (v) env[k] = v;
  } catch { }
}
env.ANS_DOMAIN = env.ANS_DOMAIN || 'docs';
// P4: ans_chat needs provider/model ids too; upstream /v1/models discovery picked 'deepseek'.
env.ANS_LLM_PROVIDER = env.ANS_LLM_PROVIDER || 'custom';
env.ANS_LLM_MODEL = env.ANS_LLM_MODEL || 'step';

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

const MODEL = arg('model', 'gemini-3.5-flash');
const args = ['-p', prompt, '--output-format', 'stream-json', '--model', MODEL,
  '--max-turns', MAXTURNS, '-y', '-d', 'hooks'];
if (!NOMCP) args.push('--mcp-config', 'mcp.json', '--strict-mcp-config');

const transcriptPath = join(EVID, `t2-${label}.stream.jsonl`);
const debugPath = join(EVID, `t2-${label}.debug.log`);
writeFileSync(transcriptPath, '');
writeFileSync(debugPath, '');

const child = spawn('codebuddy', args, { cwd: E2E, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '', dbg = '';
child.stdout.on('data', d => { out += d; appendFileSync(transcriptPath, d); });
child.stderr.on('data', d => { dbg += d; appendFileSync(debugPath, d); });

const summary = { label, ok: false, mcpServers: null, ansToolsListed: [], toolCalls: [], abstain: null, resultTail: '', errors: [], rowsBefore, rowsAfter: null };

child.on('close', () => {
  summary.rowsAfter = dbRows();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type === 'system' && m.subtype === 'init') {
      summary.mcpServers = m.mcp_servers || [];
      summary.ansToolsListed = (m.tools || []).filter(t => /anysearch|search_web|ans_chat/i.test(t));
    }
    if (m.type === 'assistant' && m.message?.content) {
      for (const c of m.message.content) {
        if (c.type === 'tool_use') summary.toolCalls.push({ name: c.name, input: JSON.stringify(c.input).slice(0, 160) });
        if (c.type === 'text') summary.resultTail = c.text.slice(-600);
      }
    }
    if (m.type === 'result') {
      summary.ok = !m.is_error;
      if (m.errors?.length) summary.errors = m.errors;
      if (m.result) summary.resultTail = String(m.result).slice(-600);
    }
  }
  // abstain detection: tool_result content carrying structured abstain marker
  summary.abstain = /"abstain"\s*:\s*true|abstain/i.test(out) ? /"abstain"\s*:\s*true/.test(out) : null;
  console.log(JSON.stringify(summary, null, 1));
});
setTimeout(() => { try { child.kill(); } catch { } summary.errors.push('timeout 240s'); console.log(JSON.stringify(summary, null, 1)); process.exit(2); }, 240000);
