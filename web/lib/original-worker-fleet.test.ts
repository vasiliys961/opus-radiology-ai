import test from "node:test";
import assert from "node:assert/strict";
import {WORKERS,probeOriginalFleet} from "./original-worker-fleet.ts";

const goodToken="L".repeat(48);
const xrv={
 schema:"opus-original-xrv-cxr-worker/v1",model:"densenet121-res224-nih",
 ready:true,weightSha256:"31a5475c6b1383a7edbfcaf96af9ce302eb9969cfe28b6b8b5859afc6f274fdf",
 originalCheckpointVerified:true,packageVersion:"1.5.7",
 patientMode:false,mode:"isolated-linux-cpu-research",
 sourcePolicy:"approved-public-nonpatient-only",
 modelLabels:["Pneumothorax","Cardiomegaly","Effusion","Pneumonia","Edema","Mass"],
};
const origin="http://127.0.0.1:3000";
test("No configured server keys -> all 10 original models explicitly NOT CONFIGURED",async()=>{
 let called=0;
 const facts=await probeOriginalFleet({},origin,async()=>{
  called++;throw Error("not called");
 });
 assert.equal(WORKERS.length,10);
 assert.equal(called,0);
 assert.equal(facts.length,10);
 assert.ok(facts.every(f=>f.status==="not_configured"&&f.clinicalValidation===false));
 assert.doesNotMatch(JSON.stringify(facts),/TOKEN|Bearer|local.*8779/);
});
test("Actual SHA verified XRV response indicates ready, not arbitrary readiness flag",async()=>{
 const urls:string[]=[];
 const input={OPUS_XRV_WORKER_TOKEN:goodToken};
 const fetcher=async(url:RequestInfo|URL,init?:RequestInit)=>{
  urls.push(String(url));
  assert.equal(String(url),"http://127.0.0.1:8779/v1/cxr/capabilities");
  assert.equal((init?.headers as Record<string,string>)?.Authorization,"Bearer "+goodToken);
  assert.equal((init?.headers as Record<string,string>)?.Origin,origin);
  return new Response(JSON.stringify(xrv),{status:200});
 };
 const out=await probeOriginalFleet(input,origin,fetcher as typeof fetch);
 assert.equal(urls.length,1);
 assert.equal(out.find(x=>x.id==="chest_xray_six")?.status,"ready");
 assert.equal(out.find(x=>x.id==="brain_glioma")?.status,"not_configured");
 assert.equal(JSON.stringify(out).includes(goodToken),false);
 const corrupted=await probeOriginalFleet(input,origin,async()=>
  new Response(JSON.stringify({...xrv,originalCheckpointVerified:false}))) ;
 assert.equal(corrupted.find(x=>x.id==="chest_xray_six")?.status,
  "original_model_unverified");
});
test("Different authentic brain checkpoints must be independently verified from ONE worker response",async()=>{
 const cap={
  schema:"opus-original-brain-multisequence-worker/v1",
  mode:"isolated-linux-cpu-research",patientMode:false,
  dataPolicy:"public-nonpatient-only",
  originalDICOMWeightingAutoInferred:false,ready:true,
  installedTasks:{
   stroke:{checkpointSha256:"f9023888c7fe616ff271559acb82addd2496581fddd0a94e2d3c80bada5bb7e9",
     installedAndHashVerified:true},
   glioma:{checkpointSha256:"860ccb3f1c21c99d0410ad8a1ac4ef6b8fab60cec0a503b0ba42675741a750ae",
     installedAndHashVerified:false},
  },
 };
 let calls=0;
 const out=await probeOriginalFleet({OPUS_BRAIN_WORKER_TOKEN:goodToken},origin,
  async()=>{calls++;return new Response(JSON.stringify(cap));});
 assert.equal(calls,1);
 assert.equal(out.find(x=>x.id==="brain_stroke")?.status,"ready");
 assert.equal(out.find(x=>x.id==="brain_glioma")?.status,"original_model_unverified");
});
test("Unknown local origin, real patient hostname, or large/failed worker reply cannot imply readiness",async()=>{
 let calls=0;
 await assert.rejects(probeOriginalFleet({OPUS_XRV_WORKER_TOKEN:goodToken},
  "https://public.example",async()=>{calls++;return new Response(JSON.stringify(xrv));}));
 assert.equal(calls,0);
 const input={OPUS_XRV_WORKER_TOKEN:goodToken};
 for(const res of [
  new Response("oops",{status:200}),
  new Response(JSON.stringify(xrv),{status:401}),
  new Response("x".repeat(20000),{status:200}),
 ]){
  const statuses=await probeOriginalFleet(input,origin,async()=>res);
  assert.notEqual(statuses.find(s=>s.id==="chest_xray_six")?.status,"ready");
 }
});
