import test from "node:test";
import assert from "node:assert/strict";
import {configuredMonaiExecutors,selectMonaiExecutor,monaiJobBinding,boundMonaiExecutor}
 from "./monai-executor-selection.ts";
const local="L".repeat(48),remote="R".repeat(48);
const env={OPUS_MONAI_WORKER_TOKEN:local,OPUS_MONAI_PRIVATE_WORKER_TOKEN:remote,
 OPUS_MONAI_PRIVATE_TUNNEL_URL:"http://127.0.0.1:18768"};
const cap={schema:"opus-monai-live-worker/v1",modelId:"monai-lung-nodule-ct-retinanet",
 modelVersion:"0.6.9",checkpointSha256:"b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01",
 modelRevision:"7226a40a4c3713f7d5469559b7f2fc296fd54825",originalWeightsVerified:true,
 mode:"local",dataPolicy:"approved-public-reference-only",sourceFormat:"original-nifti-uncompressed",
 patientMode:false,imageUpload:true,ready:true,unvalidatedResearch:true};
const signal=()=>new AbortController().signal;
test("Prefer one ready original local executor; only readiness probes, never two model launches",async()=>{
 let calls=0;
 const result=await selectMonaiExecutor(env,signal(),async(url,init)=>{
  calls++;assert.equal(String(url),"http://127.0.0.1:8768/v1/nodule/capabilities");
  assert.equal(init?.method,"GET");assert.equal(init?.redirect,"error");
  assert.equal((init?.headers as Record<string,string>).Authorization,"Bearer "+local);
  return Response.json(cap);
 });
 assert.equal(calls,1);assert.equal(result.executor?.id,"local");
});
test("Insufficient local resources selects verified private server without sending image pixels",async()=>{
 const urls:string[]=[];
 const result=await selectMonaiExecutor(env,signal(),async(url,init)=>{
  urls.push(String(url));assert.equal(init?.body,undefined);
  assert.equal((init?.headers as Record<string,string>).Host,undefined);
  return Response.json({...cap,ready:urls.length>1});
 });
 assert.equal(result.executor?.id,"private");
 assert.deepEqual(result.attempts,[{location:"local",status:"not_ready"},{location:"private",status:"ready"}]);
});
test("Unverified checkpoints, source-only workers and unreachable servers are never launchable",async()=>{
 const variants=[{...cap,checkpointSha256:"0".repeat(64)}, {...cap,imageUpload:false},
  {...cap,patientMode:true},{...cap,ready:false}];
 for(const variant of variants){
  const result=await selectMonaiExecutor(env,signal(),async()=>Response.json(variant));
  assert.equal(result.executor,null);
 }
 const missing=await selectMonaiExecutor({},signal(),async()=>{throw Error("must not call");});
 assert.deepEqual(missing.attempts,[]);
 const unreachable=await selectMonaiExecutor(env,signal(),async()=>{throw Error("offline");});
 assert.ok(unreachable.attempts.every(a=>a.status==="unreachable"));
});
test("Private target is an explicit loopback SSH tunnel, never browser SSRF or duplicated local model",()=>{
 for(const url of ["https://example.com","http://192.168.1.1:8768","http://127.0.0.1:8768",
  "http://127.0.0.1:18768/path","http://127.0.0.1:18768?x=1","http://127.0.0.1:99999",
  "http://user:pass@127.0.0.1:18768"]){
  assert.deepEqual(configuredMonaiExecutors({...env,OPUS_MONAI_PRIVATE_TUNNEL_URL:url}).map(x=>x.id),["local"]);
 }
 assert.deepEqual(configuredMonaiExecutors({...env,OPUS_LOCAL_WORKER_ORIGIN:"https://public.invalid"}),[]);
 assert.equal(configuredMonaiExecutors({OPUS_NODULE_WORKER_TOKEN:local})[0].token,local);
});
test("Poll, result and cancellation stay bound to the original executor after readiness changes",()=>{
 const job="12345678-1234-4123-8123-123456789abc",other="12345678-1234-4123-8123-123456789abd";
 const executor=configuredMonaiExecutors(env)[1],now=1_793_600_000_000;
 const binding=monaiJobBinding(executor,job,now);
 assert.equal(boundMonaiExecutor(env,binding,job,now+1000)?.id,"private");
 assert.equal(binding.includes(remote),false);
 assert.equal(boundMonaiExecutor(env,binding,other,now),null);
 assert.equal(boundMonaiExecutor(env,binding.replace("private","local"),job,now),null);
 assert.equal(boundMonaiExecutor(env,binding,job,now+4*60*60*1000),null);
 assert.equal(boundMonaiExecutor({...env,OPUS_MONAI_PRIVATE_TUNNEL_URL:"http://127.0.0.1:18769"},binding,job,now),null);
 assert.equal(boundMonaiExecutor({...env,OPUS_MONAI_PRIVATE_WORKER_TOKEN:local},binding,job,now),null);
 assert.equal(boundMonaiExecutor(env,null,job,now),null);
});
test("Cancellation stops executor discovery rather than choosing another worker",async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(selectMonaiExecutor(env,controller.signal,async()=>{
  calls++;controller.abort();throw Error("aborted");
 }));
 assert.equal(calls,1);
});
