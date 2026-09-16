// P6-precursor synthetic red/green: does adapters/claude.cjs act on real host field
// `hook_event_name` (CodeBuddy/Claude Code) vs legacy `event`?
// Observable = server /recall hit-count delta (PostToolUse distill -> /index call).
// Usage: node synthetic-stdin-red.mjs   (run with cwd = e2e project dir)
import { spawn, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const E2E = process.cwd();
// ANS_ADAPTER overrides the adapter under test (repo build for T3 green, npm-global
// for T1 red / T4 tarball verify). Default: npm-global claude adapter.
const NPM_G = execSync('npm root -g', { encoding: 'utf8' }).trim();
const ADAPTER = process.env.ANS_ADAPTER || NPM_G + '/@anysearch-cli/plugin/dist/hooks/adapters/claude.cjs';
console.error('[synthetic] adapter: ' + ADAPTER);
const TOKEN = readFileSync(E2E + '/.anysearch-cli/server-token', 'utf8').trim();

const post = (path, body) => new Promise((resolve) => {
  const req = http.request({
    host: '127.0.0.1', port: 33333, path, method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }
  },
    (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ code: res.statusCode, body: b })); });
  req.on('error', (e) => resolve({ code: 0, body: String(e) }));
  req.end(JSON.stringify(body));
});

const recallCount = async () => {
  const r = await post('/recall', { projectPath: E2E, query: 'synthetic-r65-probe', limit: 10 });
  try { return JSON.parse(r.body).hits?.length ?? -1; } catch { return -1; }
};

const runHook = (stdinObj) => new Promise((resolve) => {
  const p = spawn(process.execPath, [ADAPTER], { stdio: ['pipe', 'pipe', 'pipe'], cwd: E2E });
  let out = '', err = '';
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => err += d);
  p.on('close', (code) => resolve({ code, stdout: out, stderr: err.slice(-400) }));
  p.stdin.end(JSON.stringify(stdinObj));
});

// Run-unique titles: /index dedups on content_hash(url+title+snippet) — a second run
// of identical docs would mask a real write as a 0-delta. Unique per run.
const runId = Date.now().toString(36);
const toolResp = JSON.stringify({
  results: [
    { title: `synthetic-r65-probe alpha ${runId}`, url: `https://example.com/a-${runId}`, snippet: 'probe doc alpha', source: 'synthetic' },
    { title: `synthetic-r65-probe beta ${runId}`, url: `https://example.com/b-${runId}`, snippet: 'probe doc beta', source: 'synthetic' },
  ]
});
const base = {
  tool_name: 'mcp__anysearch__search_web', tool_input: { query: 'synthetic-r65-probe' },
  tool_response: toolResp, session_id: 'syn-r65', cwd: E2E
};

const before = await recallCount();
const real = await runHook({ hook_event_name: 'PostToolUse', ...base });   // real CodeBuddy shape
await new Promise(r => setTimeout(r, 800));
const afterReal = await recallCount();
const legacy = await runHook({ event: 'PostToolUse', ...base });           // legacy field the adapter reads
await new Promise(r => setTimeout(r, 800));
const afterLegacy = await recallCount();

console.log(JSON.stringify({
  recall_before: before,
  real_host_field: { exit: real.code, stdout: real.stdout || '(empty)', recall_after: afterReal, indexed: afterReal - before },
  legacy_field: { exit: legacy.code, stdout: legacy.stdout || '(empty)', recall_after: afterLegacy, indexed: afterLegacy - afterReal },
  verdict: (afterReal === before && afterLegacy > afterReal)
    ? 'RED CONFIRMED: hook_event_name silently ignored; event field works (contract defect isolated to field name)'
    : (afterReal > before && afterLegacy === afterReal)
      ? 'GREEN: hook_event_name honored (indexes), legacy field also works, dedup-safe'
      : 'unexpected — inspect raw',
}, null, 2));
