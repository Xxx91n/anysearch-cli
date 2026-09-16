// T1 smoke: spawn ans-mcp over stdio, initialize, tools/list, print tool names.
// Usage: node mcp-tools-list.mjs [spawnCommand]  (default: ans-mcp from PATH)
import { spawn, execSync } from 'node:child_process';

// Spawn via node + resolved dist path — the npm .cmd shim under `shell:true`
// double-wraps cmd.exe and swallows piped stdin on Windows.
const cmd = process.argv[2]; // optional explicit "node-args" style: pass dist path
let child;
if (cmd) {
  child = spawn(process.execPath, [cmd], { stdio: ['pipe', 'pipe', 'pipe'] });
} else {
  const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  const dist = npmRoot + '/@anysearch-cli/mcp/dist/index.cjs';
  console.error('[smoke] spawn: node ' + dist);
  child = spawn(process.execPath, [dist], { stdio: ['pipe', 'pipe', 'pipe'] });
}

let buf = '';
const out = { initOk: false, tools: [], error: null };
const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't1-smoke', version: '0' } } });

child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === 1 && msg.result) {
      out.initOk = true;
      out.serverInfo = msg.result.serverInfo || null;
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    } else if (msg.id === 1 && msg.error) {
      out.error = 'init: ' + JSON.stringify(msg.error);
    } else if (msg.id === 2 && msg.result) {
      out.tools = (msg.result.tools || []).map(t => t.name);
      finish(0);
    } else if (msg.id === 2 && msg.error) {
      out.error = 'tools/list: ' + JSON.stringify(msg.error);
      finish(1);
    }
  }
});
child.stderr.on('data', (d) => { out.stderrTail = (out.stderrTail || '') + d.toString().slice(-2000); });
child.on('error', (e) => { out.error = 'spawn: ' + e.message; finish(1); });

const timer = setTimeout(() => { out.error = 'timeout 15s'; finish(1); }, 15000);
function finish(code) {
  clearTimeout(timer);
  try { child.kill(); } catch { }
  console.log(JSON.stringify(out, null, 2));
  process.exit(code);
}
