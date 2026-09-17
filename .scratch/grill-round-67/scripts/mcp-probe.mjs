// R67 raw-stdio MCP probe: initialize + tools/list + tools/call against a server dist.
// Usage: node mcp-probe.mjs <dist-index.cjs> <op> [argsJson]
//   ops: list | search <query> | recall <query> | research <query> | knowledge <query> | chat <msg>
// Prints compact JSON verdict to stdout; full result saved to <cwd>/mcp-probe-last.json
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import * as fs2 from 'node:fs';

const [,,DIST,OP,...REST]=process.argv;
const argsJson=REST.join(' ');
const env={...process.env};
{const{execSync}=await import('node:child_process');
for(const k of ['ANYSEARCH_API_KEY','ANYSEARCH_ENDPOINT','ANS_LLM_BASE_URL','ANS_LLM_API','ANS_LLM_API_KEY','EXA_API_KEY','TAVILY_API_KEY','ANS_LLM_PROVIDER','ANS_LLM_MODEL']){
 if(env[k])continue;try{const o=execSync('reg query HKCU'+String.fromCharCode(92)+'Environment /v '+k,{encoding:'utf8'});const m=o.match(/REG_SZ\s+(.+)/);if(m)env[k]=m[1].trim()}catch{}}}
env.ANS_DOMAIN=env.ANS_DOMAIN||'docs';
env.ANS_PROJECT_DB=env.ANS_PROJECT_DB||'D:/Aworker/e2e-r67-codex/.anysearch/project-index.db';
try{env.ANS_SERVER_TOKEN=fs2.readFileSync('D:/Aworker/e2e-r67-codex/.anysearch-cli/server-token-r67','utf8').trim();env.ANS_SERVER_URL='http://127.0.0.1:33334'}catch{}
const child=spawn(process.execPath,[DIST],{stdio:['pipe','pipe','pipe'],env});
let buf='';const pending=new Map();let idc=0;
child.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line.trim())continue;try{const m=JSON.parse(line);if(m.id!==undefined&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}}catch{}}});
child.stderr.on('data',()=>{});
const send=(method,params)=>new Promise((res,rej)=>{const id=++idc;pending.set(id,res);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');setTimeout(()=>{if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+method))}},240000)});
const TOOL={search:'search_web',recall:'recall_memory',research:'research_web',knowledge:'query_knowledge',chat:'ans_chat'};
const ARG={search:q=>({query:q}),recall:q=>({query:q}),research:q=>({question:q}),knowledge:q=>({query:q}),chat:q=>({message:q})};
try{
  const init=await send('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'r67-probe',version:'0'}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const tools=await send('tools/list',{});
  const names=(tools.result?.tools||[]).map(t=>t.name);
  let call=null;
  if(OP!=='list'){
    const tn=TOOL[OP];const q=JSON.parse(argsJson||'"probe"');
    call=await send('tools/call',{name:tn,arguments:ARG[OP](q)});
  }
  writeFileSync('mcp-probe-last.json',JSON.stringify({init,tools,call},null,1));
  const text=call?.result?.content?.map(c=>c.text||'').join('')||'';
  let parsed=null;try{parsed=JSON.parse(text)}catch{}
  console.log(JSON.stringify({op:OP,server:init.result?.serverInfo?.name,tools:names,callTextHead:text.slice(0,700),abstain:parsed?.abstain,total:parsed?.totalResults,urls:(parsed?.results||[]).slice(0,8).map(r=>r.url)}));
}catch(e){console.log(JSON.stringify({op:OP,error:String(e)}));}
child.kill();process.exit(0);
