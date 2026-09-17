// env-dump stub: records which ANS_*/ANYSEARCH_* keys + cwd reach hook env
const fs=require('fs');let i='';process.stdin.on('data',d=>i+=d).on('end',()=>{
 const keys=Object.keys(process.env).filter(k=>/ANS_|ANYSEARCH|OPENAI|CODEX/i.test(k)).sort();
 const rec={at:new Date().toISOString(),cwd:process.cwd(),ansKeys:keys.map(k=>k+'='+(process.env[k]?'set':'')+'#len'+(process.env[k]||'').length),stdinHead:i.slice(0,300)};
 fs.appendFileSync('D:/Aworker/e2e-r67-codex/env-dump.jsonl',JSON.stringify(rec)+'\n');
 process.exit(0);});
