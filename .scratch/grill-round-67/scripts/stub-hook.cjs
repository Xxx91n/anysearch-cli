// R67 T1 contract-form stub hook. argv: <form> <nonce> <markerfile>
// forms: L0 empty {} | L1 envelope | L2 bare top-level | L3 plain text | L1P mixed
const [,,form,nonce,mf]=process.argv;
const fs=require('fs');
let input='';process.stdin.on('data',d=>input+=d).on('end',()=>{
  try{fs.appendFileSync(mf,JSON.stringify({form,nonce,at:new Date().toISOString(),stdinHead:input.slice(0,240)})+String.fromCharCode(10))}catch{}
  const mark='ANS_R67_'+form+'_'+nonce;
  if(form==='L0')process.stdout.write('{}');
  else if(form==='L1')process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:mark}}));
  else if(form==='L2')process.stdout.write(JSON.stringify({additionalContext:mark}));
  else if(form==='L3')process.stdout.write(mark);
  else if(form==='L1P')process.stdout.write(JSON.stringify({systemMessage:'sysmsg-'+nonce,hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:mark}}));
  else if(form==='EV'){let ev='SessionStart';try{ev=JSON.parse(input).hook_event_name||ev}catch{}process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:ev,additionalContext:mark}}));}
  process.exit(0);
});
