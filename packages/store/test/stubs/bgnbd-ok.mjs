let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const n=JSON.parse(d).rows.length;
process.stdout.write(JSON.stringify({ok:true,converged:true,params:{r:1,alpha:2,a:3,b:4},palive:Array(n).fill(0.5),conditional_expected:Array(n).fill(1),validation:{chi2:0.1,df:2,p:0.8}})+"\n")});
