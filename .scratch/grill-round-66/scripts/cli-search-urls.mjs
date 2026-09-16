// CLI contrast leg: `ans search <q> --json` with User env injected. Prints URL|source lines.
import { execSync } from 'node:child_process';
const q = process.argv[2] || 'modelcontextprotocol specification';
const env = { ...process.env, ANS_DOMAIN: process.env.ANS_DOMAIN || 'docs' };
for (const k of ['ANYSEARCH_API_KEY','ANYSEARCH_ENDPOINT','EXA_API_KEY','TAVILY_API_KEY','ANS_LLM_BASE_URL','ANS_LLM_API','ANS_LLM_API_KEY','ANS_LLM_PROVIDER','ANS_LLM_MODEL']) {
  if (!env[k]) { try { const v = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\''+k+'\',\'User\')"',{encoding:'utf8'}).trim(); if(v) env[k]=v; } catch {} }
}
const out = execSync('ans search "' + q + '" --json', { encoding: 'utf8', env, maxBuffer: 1 << 22 });
const j = JSON.parse(out);
console.log('total=' + (j.results||[]).length);
for (const r of (j.results || [])) console.log((r.source || '?') + ' | ' + r.url);
console.log('abstain=' + JSON.stringify(j.abstain));
console.log('sufficiency=' + JSON.stringify(j.sufficiency));
