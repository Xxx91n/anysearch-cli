// Launch plugin server detached (survives caller), env injected from User scope.
// Usage: node start-server.mjs <serverDistPath> <cwdE2E> [logPath]
import { spawn, execSync } from 'node:child_process';
import { openSync, writeFileSync } from 'node:fs';
const dist = process.argv[2];
const cwd = process.argv[3];
const logPath = process.argv[4] || cwd + '/server.log';
const env = { ...process.env };
for (const k of ['ANYSEARCH_API_KEY','ANYSEARCH_ENDPOINT','ANS_LLM_BASE_URL','ANS_LLM_API','ANS_LLM_API_KEY','EXA_API_KEY','TAVILY_API_KEY','ANS_LLM_PROVIDER','ANS_LLM_MODEL','ANS_DOMAIN']) {
  if (!env[k]) { try { const v = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\''+k+'\',\'User\')"',{encoding:'utf8'}).trim(); if(v) env[k]=v; } catch {} }
}
env.ANS_DOMAIN = env.ANS_DOMAIN || 'docs';
const fd = openSync(logPath, 'a');
const c = spawn(process.execPath, [dist], { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
c.unref();
writeFileSync(cwd + '/.server-pid', String(c.pid));
console.log('server pid=' + c.pid + ' log=' + logPath);
