// Direct tools/call printing only result URLs+sources. Usage: node call-search-urls.mjs '<jsonArgs>'
import { spawn, execSync } from 'node:child_process';
const args = JSON.parse(process.argv[2] || '{}');
const env = { ...process.env };
for (const k of ['ANYSEARCH_API_KEY','ANYSEARCH_ENDPOINT','ANS_LLM_BASE_URL','ANS_LLM_API','ANS_LLM_API_KEY','EXA_API_KEY','TAVILY_API_KEY','ANS_LLM_PROVIDER','ANS_LLM_MODEL']) {
  if (!env[k]) { try { const v = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\''+k+'\',\'User\')"',{encoding:'utf8'}).trim(); if(v) env[k]=v; } catch {} }
}
env.ANS_DOMAIN = env.ANS_DOMAIN || 'docs';
const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
const child = spawn(process.execPath, [npmRoot + '/@anysearch-cli/mcp/dist/index.cjs'], { stdio: ['pipe','pipe','pipe'], env });
let buf='';
const send=m=>child.stdin.write(JSON.stringify(m)+'\n');
send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'u',version:'0'}}});
child.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!l)continue;let m;try{m=JSON.parse(l)}catch{continue}
if(m.id===1&&m.result){send({jsonrpc:'2.0',method:'notifications/initialized'});send({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'search_web',arguments:args}});}
else if(m.id===2){const t=(m.result?.content||[]).map(c=>c.text||'').join('\n');try{const j=JSON.parse(t);console.log('totalResults='+j.totalResults+' showing='+j.showing);for(const r of (j.results||[]))console.log((r.source||'?')+' | '+r.url);if(j.abstain!==undefined)console.log('abstain='+JSON.stringify(j.abstain));if(j.sufficiency)console.log('sufficiency='+JSON.stringify(j.sufficiency));}catch{console.log(t.slice(0,2000));}child.kill();process.exit(0);}}});
setTimeout(()=>{console.log('timeout');child.kill();process.exit(1)},90000);
