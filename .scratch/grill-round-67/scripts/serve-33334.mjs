// R67 server launcher — port 33334 + token file (avoids 33333 squatter from r66).
// Token file: <e2e>/.anysearch-cli/server-token-r67 (0600). Never prints the token.
import { spawn } from 'node:child_process';
import { openSync, writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const E2E='D:/Aworker/e2e-r67-codex';
const TOKF=E2E+'/.anysearch-cli/server-token-r67';
mkdirSync(E2E+'/.anysearch-cli',{recursive:true});
let tok = existsSync(TOKF) ? readFileSync(TOKF,'utf8').trim() : '';
if(!tok){ tok=randomBytes(32).toString('hex'); writeFileSync(TOKF,tok+'\n',{mode:0o600}); }
try{chmodSync(TOKF,0o600)}catch{}
const env={...process.env};
// inherit user-scope keys
const{execSync}=await import('node:child_process');
for(const k of ['ANYSEARCH_API_KEY','ANYSEARCH_ENDPOINT','ANS_LLM_BASE_URL','ANS_LLM_API','ANS_LLM_API_KEY','EXA_API_KEY','TAVILY_API_KEY','ANS_LLM_PROVIDER','ANS_LLM_MODEL']){
 if(env[k])continue;try{const o=execSync('reg query HKCU'+String.fromCharCode(92)+'Environment /v '+k,{encoding:'utf8'});const m=o.match(/REG_SZ\s+(.+)/);if(m)env[k]=m[1].trim()}catch{}
}
env.ANS_DOMAIN='docs';
env.ANS_SERVER_PORT='33334';
env.ANS_SERVER_TOKEN=tok;
const fd=openSync(E2E+'/server-33334.log','a');
const c=spawn(process.execPath,['D:/nodejs/node_modules/@anysearch-cli/plugin/dist/server/index.cjs'],{cwd:E2E,env,detached:true,stdio:['ignore',fd,fd]});
c.unref();
writeFileSync(E2E+'/.server-pid-33334',String(c.pid));
console.log('server pid='+c.pid+' port=33334 tokenfile set (not printed)');
