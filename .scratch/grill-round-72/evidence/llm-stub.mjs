import http from 'node:http';
import { appendFileSync } from 'node:fs';
const REQLOG='D:/Aworker/dsh-r72-spike/llm-stub-reqs.log';
let n=0;
const CHUNK=(delta,finish)=>({id:'chatcmpl-stub',object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'stub-model',choices:[{index:0,delta,finish_reason:finish}]});
const srv=http.createServer((req,res)=>{
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    n++;
    try{appendFileSync(REQLOG,'LLM_STUB|req#'+n+' '+req.method+' '+req.url+'\n'+body+'\n')}catch{}
    if(req.url.includes('/models')){
      res.writeHead(200,{'content-type':'application/json'});
      return res.end(JSON.stringify({object:'list',data:[{id:'stub-model',object:'model'}]}));
    }
    let parsed=null;try{parsed=JSON.parse(body)}catch{}
    const stream=parsed?.stream===true;
    const msgs=Array.isArray(parsed?.messages)?parsed.messages:[];
    const toolResults=msgs.filter(m=>m.role==='tool').length;
    const isTitle=JSON.stringify(msgs[0]?.content??'').includes('title for an AI coding-assistant session');
    const send=(payload)=>{
      if(stream){
        res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
        for(const c of payload)res.write('data: '+JSON.stringify(c)+'\n\n');
        res.write('data: [DONE]\n\n');res.end();
      }else{
        res.writeHead(200,{'content-type':'application/json'});
        const msg=payload[0].delta;const fin=payload[payload.length-1].finish_reason;
        res.end(JSON.stringify({id:'chatcmpl-stub',object:'chat.completion',created:0,model:'stub-model',
          choices:[{index:0,finish_reason:fin,message:{role:'assistant',...msg}}],
          usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}));
      }
    };
    const tc=(name,args)=>({index:0,id:'call_'+n,type:'function',function:{name,arguments:JSON.stringify(args)}});
    if(isTitle){ send([CHUNK({role:'assistant',content:'probe session'},null),CHUNK({},'stop')]); }
    else if(toolResults===0){ send([CHUNK({role:'assistant',content:null,tool_calls:[tc('mcp__anysearch__search_web',{query:'go to https://blocked.example/path now'})]},null),CHUNK({},'tool_calls')]); }
    else if(toolResults===1){ send([CHUNK({role:'assistant',content:null,tool_calls:[tc('mcp__anysearch__search_web',{query:'anysearch r72 clean probe'})]},null),CHUNK({},'tool_calls')]); }
    else { send([CHUNK({role:'assistant',content:'PROBE_TURN_COMPLETE'},null),CHUNK({},'stop')]); }
  });
});
srv.listen(28123,'127.0.0.1',()=>process.stderr.write('LLM_STUB|v4 listening\n'));
setInterval(()=>{},60000);
