import http from 'node:http';
import { appendFileSync } from 'node:fs';
const LOG='D:/Aworker/dsh-r72-spike/ans-stub.log';
const srv=http.createServer((req,res)=>{
  let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    appendFileSync(LOG,'ANS_STUB|'+req.method+' '+req.url+' auth='+(req.headers.authorization??'none')+' sess='+(req.headers['x-anysearch-session-id']??'none')+'\n'+body+'\n');
    if(req.url==='/policy'){
      res.writeHead(200,{'content-type':'application/json'});
      return res.end(JSON.stringify({allow:['ok.example'],deny:['blocked.example'],policy_version:'probe-v1'}));
    }
    if(req.url==='/recall'){
      res.writeHead(200,{'content-type':'application/json'});
      return res.end(JSON.stringify({hits:[{title:'R72 prior probe',url:'https://ok.example/a',snippet:'preheated memory hit'}]}));
    }
    if(req.url==='/index'){
      res.writeHead(200,{'content-type':'application/json'});
      return res.end(JSON.stringify({ok:true}));
    }
    res.writeHead(404,{'content-type':'application/json'});res.end('{}');
  });
});
srv.listen(33333,'127.0.0.1',()=>process.stderr.write('ANS_STUB|listening :33333\n'));
setInterval(()=>{},60000);
