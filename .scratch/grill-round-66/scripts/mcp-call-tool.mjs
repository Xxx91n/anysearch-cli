// Direct MCP tools/call harness — bypasses CodeBuddy to isolate tool behavior.
// Usage: node mcp-call-tool.mjs <toolName> '<jsonArgs>' [timeoutSec]
// Injects User-level env (never printed). Prints the tool's text content.
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';

const toolName = process.argv[2];
const toolArgs = JSON.parse(process.argv[3] || '{}');
const timeoutSec = Number(process.argv[4] || 90);

const env = { ...process.env };
for (const k of ['ANYSEARCH_API_KEY', 'ANS_LLM_BASE_URL', 'ANS_LLM_API', 'ANS_LLM_API_KEY',
  'EXA_API_KEY', 'TAVILY_API_KEY', 'ANS_LLM_PROVIDER', 'ANS_LLM_MODEL']) {
  if (!env[k]) {
    try {
      const v = execSync(`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('${k}','User')"`, { encoding: 'utf8' }).trim();
      if (v) env[k] = v;
    } catch { }
  }
}
env.ANS_DOMAIN = env.ANS_DOMAIN || 'docs';
env.ANS_LLM_PROVIDER = env.ANS_LLM_PROVIDER || 'custom';
env.ANS_LLM_MODEL = env.ANS_LLM_MODEL || 'glm1';

let npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
let dist = npmRoot + '/@anysearch-cli/mcp/dist/index.cjs';
if (!fs.existsSync(dist)) dist = 'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@anysearch-cli/mcp/dist/index.cjs';
const child = spawn(process.execPath, [dist], { stdio: ['pipe', 'pipe', 'pipe'], env });

let buf = '';
const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'call-smoke', version: '0' } } });

child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === 1 && msg.result) {
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: toolArgs } });
    } else if (msg.id === 2) {
      const text = (msg.result?.content || []).map(c => c.text || '').join('\n');
      console.log(JSON.stringify({ isError: msg.result?.isError ?? null, error: msg.error ?? null, text: text.slice(0, 3000) }, null, 1));
      finish(0);
    }
  }
});
child.stderr.on('data', d => process.stderr.write('[srv] ' + d.toString().slice(0, 500)));
const timer = setTimeout(() => { console.log(JSON.stringify({ error: 'timeout ' + timeoutSec + 's' })); finish(1); }, timeoutSec * 1000);
function finish(code) { clearTimeout(timer); try { child.kill(); } catch { } process.exit(code); }
