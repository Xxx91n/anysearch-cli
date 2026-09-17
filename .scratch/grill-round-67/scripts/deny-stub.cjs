// argv: <shape> <nonce> ; shape=env|legacy|exit2|toplevel
const [,,shape,nonce]=process.argv;
let i='';process.stdin.on('data',d=>i+=d).on('end',()=>{
  const r='ANS_R67_DENY_'+shape+'_'+nonce;
  if(shape==='env')process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:r}}));
  else if(shape==='legacy')process.stdout.write(JSON.stringify({decision:'block',reason:r}));
  else if(shape==='toplevel')process.stdout.write(JSON.stringify({permissionDecision:'deny',permissionDecisionReason:r}));
  else if(shape==='exit2'){process.stderr.write(r);process.exit(2)}
  process.exit(0);});
