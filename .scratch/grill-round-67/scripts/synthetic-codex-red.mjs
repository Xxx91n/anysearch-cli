// R67 T1 synthetic-stdin contract probe for codex.cjs adapter (published 0.0.4 or override).
// Observable = adapter stdout shape + server /recall hit delta (PostToolUse -> /index).
// Usage: node synthetic-codex-red.mjs   (cwd = e2e project dir; server must be up)
import { spawn, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const E2E = process.cwd();
const NPM_G = execSync('npm root -g', { encoding: 'utf8' }).trim();
const ADAPTER = process.env.ANS_ADAPTER || NPM_G + '/@anysearch-cli/plugin/dist/hooks/adapters/codex.cjs';
console.error('[synthetic] adapter: ' + ADAPTER);
const TOKEN = readFileSync(E2E + '/.anysearch-cli/server-token-r67', 'utf8').trim();

const post = (path, body) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port: 33334, path, method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } },
    (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ code: res.statusCode, body: b })); });
  req.on('error', (e) => resolve({ code: 0, body: String(e) }));
  req.end(JSON.stringify(body));
});
const recallCount = async () => {
  const r = await post('/recall', { projectPath: E2E, query: 'synthetic-r67-probe', limit: 10 });
  try { return JSON.parse(r.body).hits?.length ?? -1; } catch { return -1; }
};
const runHook = (stdinObj) => new Promise((resolve) => {
  const p = spawn(process.execPath, [ADAPTER], { stdio: ['pipe', 'pipe', 'pipe'], cwd: E2E, env: { ...process.env, ANS_SERVER_URL: 'http://127.0.0.1:33334', ANS_SERVER_TOKEN: TOKEN } });
  let out = '', err = '';
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => err += d);
  p.on('close', (code) => resolve({ code, stdout: out, stderr: err.slice(-400) }));
  p.stdin.end(JSON.stringify(stdinObj));
});

const runId = Date.now().toString(36);
const toolResp = JSON.stringify({ results: [
  { title: 'synthetic-r67-probe alpha ' + runId, url: 'https://example.com/a-' + runId, snippet: 'probe doc alpha', source: 'synthetic' },
  { title: 'synthetic-r67-probe beta ' + runId, url: 'https://example.com/b-' + runId, snippet: 'probe doc beta', source: 'synthetic' },
]});
const base = { tool_name: 'mcp__anysearch__search_web', tool_input: { query: 'synthetic-r67-probe' },
  tool_response: toolResp, session_id: 'syn-r67', cwd: E2E };

const before = await recallCount();
const real = await runHook({ hook_event_name: 'PostToolUse', ...base });
await new Promise(r => setTimeout(r, 800));
const afterReal = await recallCount();
const legacy = await runHook({ event: 'PostToolUse', ...base });
await new Promise(r => setTimeout(r, 800));
const afterLegacy = await recallCount();

console.log(JSON.stringify({
  recall_before: before,
  real_host_field: { exit: real.code, stdout: real.stdout || '(empty)', recall_after: afterReal, indexed: afterReal - before },
  legacy_field: { exit: legacy.code, stdout: legacy.stdout || '(empty)', recall_after: afterLegacy, indexed: afterLegacy - afterReal },
  verdict: (afterReal > before)
    ? 'GREEN-input: hook_event_name honored by codex adapter (indexed +'+ (afterReal-before) +')'
    : (afterLegacy > afterReal)
      ? 'RED CONFIRMED: hook_event_name ignored; legacy event works'
      : 'unexpected - inspect raw stdout/exit',
}, null, 2));
