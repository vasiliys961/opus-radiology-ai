/** Isolated real Next API lifecycle with synthetic workers; never model inference.
 * Does not read/copy workstation .env files, weights, studies or provider keys. */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,mkdir,cp,writeFile,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
const root=fileURLToPath(new URL("../",import.meta.url));
const temp=await mkdtemp(join(tmpdir(),"opus-monai-selection-"));
const job="12345678-1234-4123-8123-123456789abc",token="S".repeat(48);
const cap={schema:"opus-monai-live-worker/v1",modelId:"monai-lung-nodule-ct-retinanet",
 modelVersion:"0.6.9",checkpointSha256:"b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01",
 modelRevision:"7226a40a4c3713f7d5469559b7f2fc296fd54825",originalWeightsVerified:true,
 mode:"local",dataPolicy:"approved-public-reference-only",sourceFormat:"original-nifti-uncompressed",
 patientMode:false,imageUpload:true,ready:true,unvalidatedResearch:true};
let privateRunning=false,uploads=0;const calls=[],fixtureErrors=[];
function fixture(location){return createServer(async(req,res)=>{
 try{
 calls.push([location,req.method,req.url]);
 assert.equal(req.headers.host,"127.0.0.1:"+req.socket.localPort);
 assert.equal(req.headers.authorization,"Bearer "+token);
 let result;
 if(req.url==="/v1/nodule/capabilities")result={...cap,
  ready:location==="private"?!privateRunning:privateRunning,privateSecretSentinel:token};
 else if(req.url==="/v1/nodule/upload"){
  assert.equal(location,"private");uploads++;
  for await(const _ of req){} // synthetic bytes only
  privateRunning=true;result={schema:"opus-monai-job/v1",jobId:job,state:"running"};
 }else if(req.url.endsWith("/report"))result={schema:"opus-monai-bound-nodule-inference/v1",syntheticTransportTest:true};
 else if(req.method==="DELETE")result={deleted:true};
 else result={schema:"opus-monai-job/v1",jobId:job,state:"running"};
 res.setHeader("content-type","application/json");res.end(JSON.stringify(result));
 }catch(error){fixtureErrors.push(error.message);res.statusCode=500;res.end("synthetic fixture error");}
});}
const listen=(server,port)=>new Promise((resolve,reject)=>{
 server.once("error",reject);server.listen(port,"127.0.0.1",()=>resolve(server.address().port));
});
const local=fixture("local"),remote=fixture("private");let next;
try{
 await listen(local,8768);const remotePort=await listen(remote,0);
 const probe=createServer();const port=await listen(probe,0);await new Promise(r=>probe.close(r));
 await cp(join(root,"web/lib"),join(temp,"lib"),{recursive:true});
 const routeDir=join(temp,"app/api/local-nodule/[...parts]");await mkdir(routeDir,{recursive:true});
 await cp(join(root,"web/app/api/local-nodule/[...parts]/route.ts"),join(routeDir,"route.ts"));
 await writeFile(join(temp,"app/layout.tsx"),'export default function Layout({children}: {children: React.ReactNode}) {return <html><body>{children}</body></html>}');
 await writeFile(join(temp,"app/page.tsx"),'export default function Page(){return <p>Synthetic API transport test</p>}');
 await writeFile(join(temp,"package.json"),JSON.stringify({type:"module",dependencies:{next:"16.4.4",react:"19.2.0","react-dom":"19.2.0"}}));
 await writeFile(join(temp,"tsconfig.json"),JSON.stringify({compilerOptions:{module:"esnext",moduleResolution:"bundler",allowImportingTsExtensions:true,jsx:"react-jsx",esModuleInterop:true,skipLibCheck:true},exclude:["node_modules"]}));
 await symlink(join(root,"web/node_modules"),join(temp,"node_modules"),"dir");
 const base="http://127.0.0.1:"+port;
 const env={NODE_ENV:"development",PATH:process.env.PATH,HOME:process.env.HOME,
  TMPDIR:process.env.TMPDIR,NEXT_TELEMETRY_DISABLED:"1",
  OPUS_MONAI_WORKER_TOKEN:token,OPUS_MONAI_PRIVATE_WORKER_TOKEN:token,
  OPUS_MONAI_PRIVATE_TUNNEL_URL:"http://127.0.0.1:"+remotePort,OPUS_LOCAL_WORKER_ORIGIN:base};
 next=spawn(process.execPath,[join(root,"web/node_modules/next/dist/bin/next"),"dev","--webpack","--hostname","127.0.0.1","--port",String(port)],
  {cwd:temp,env,stdio:["ignore","pipe","pipe"]});
 let logs="";next.stdout.on("data",b=>logs=(logs+b).slice(-3000));next.stderr.on("data",b=>logs=(logs+b).slice(-3000));
 const deadline=Date.now()+90_000;let response;
 while(Date.now()<deadline){
  if(next.exitCode!==null)throw Error("Isolated Next stopped: "+logs);
  try{response=await fetch(base+"/api/local-nodule/v1/nodule/capabilities",{signal:AbortSignal.timeout(20_000)});if(response.ok)break;}catch{}
  await new Promise(r=>setTimeout(r,500));
 }
 assert.equal(response?.status,200,logs);
 const selected=await response.json();assert.equal(selected.automaticExecution.location,"private");
 assert.equal(JSON.stringify(selected).includes(token),false);
 const headers={origin:base,"content-type":"application/octet-stream",
  "x-opus-public-research-authorization":"approved-nonpatient-source","x-opus-source-sha256":"a".repeat(64)};
 const upload=await fetch(base+"/api/local-nodule/v1/nodule/upload",{method:"POST",headers,body:new Uint8Array(352)});
 assert.equal(upload.status,201);const started=await upload.json();
 assert.equal(started.executorLocation,"private");assert.equal(uploads,1);
 const afterUpload=calls.length;
 for(const [method,suffix] of [["GET",""],["GET","/report"],["DELETE",""]]){
  const r=await fetch(base+"/api/local-nodule/v1/nodule/jobs/"+job+suffix,
   {method,headers:{origin:base,"x-opus-monai-job-binding":started.executorBinding}});
  assert.equal(r.status,200,method+suffix);
 }
 assert.deepEqual(calls.slice(afterUpload).map(c=>c.slice(0,2)),[["private","GET"],["private","GET"],["private","DELETE"]]);
 const forged=await fetch(base+"/api/local-nodule/v1/nodule/jobs/"+job,
  {headers:{"x-opus-monai-job-binding":started.executorBinding.replace("private","local")}});
 assert.equal(forged.status,401);assert.equal(uploads,1);
 assert.deepEqual(fixtureErrors,[]);
 console.log("PASS: real Next API selects private worker, uploads once, keeps poll/report/cancel there after RAM readiness changes; synthetic transport only");
}finally{
 if(next&&next.exitCode===null){next.kill("SIGTERM");await new Promise(resolve=>next.once("exit",resolve));}
 for(const server of [local,remote]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
