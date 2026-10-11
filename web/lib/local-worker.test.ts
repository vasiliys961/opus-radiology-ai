import test from "node:test";
import assert from "node:assert/strict";
import { checkLocalWorker, runLocalR231, workerEndpoint, R231_SHA256 } from "./local-worker.ts";
import { sha256, writeScalarNifti, type AnalysisPackage } from "./analysis-package.ts";

const session={endpoint:"http://127.0.0.1:8765",token:"a".repeat(43)};
const caps={schema:"opus-worker-capabilities/v1",mode:"local",device:"cpu",dataPolicy:"public-reference-only",patientMode:false,externalEgress:false,concurrency:1,maxVoxels:8388608,
  model:{id:"lungmask-R231",version:"0.2.20",weightsSha256:R231_SHA256,ready:true}};
async function packet(): Promise<AnalysisPackage> {
  const geometry={dimensions:[3,2,3] as [number,number,number],affineLps:[1,0,0,0,0,1,0,0,0,0,-2,4] as [number,number,number,number,number,number,number,number,number,number,number,number]};
  const buffer=await writeScalarNifti(geometry,i=>i%3);
  return {buffer,request:{schema:"opus-analysis-request/v1",requestId:crypto.randomUUID(),sourceIdentitySha256:"b".repeat(64),inputSha256:await sha256(buffer),geometry,modality:"CT",frameCount:3,
    input:{format:"NIfTI-1",datatype:"float32",scalarValues:"cornerstone-decoded-no-additional-normalization"},scope:"selected-series-only",sequence:"not-confirmed",coverage:"not-confirmed"}};
}

test("worker endpoint rejects outbound hosts, HTTPS proxies, paths and embedded credentials",()=>{
  assert.equal(workerEndpoint(session.endpoint),session.endpoint);
  for(const url of ["https://api.example.org","http://localhost:8765","http://127.0.0.1:8765/path","http://127.0.0.1:8765?token=x","http://secret@127.0.0.1:8765","http://127.0.0.1"])
    assert.throws(()=>workerEndpoint(url));
});

test("readiness requires installed pinned R231 and closed patient/external routes",async t=>{
  for(const change of [{patientMode:true},{externalEgress:true},{mode:"gpu-server"},{model:{...caps.model,ready:false}},{model:{...caps.model,weightsSha256:"c".repeat(64)}}]) {
    t.mock.method(globalThis,"fetch",async()=>Response.json({...caps,...change}));
    await assert.rejects(checkLocalWorker(session),/не установлена/);
    t.mock.restoreAll();
  }
});

test("synthetic contract fixture returns exact bound mask and deletes job; no medical inference",async t=>{
  const p=await packet(),jobId=crypto.randomUUID(),calls:string[]=[];
  const result={schema:"opus-segmentation-result/v1",requestId:p.request.requestId,sourceIdentitySha256:p.request.sourceIdentitySha256,inputSha256:p.request.inputSha256,
    maskSha256:await sha256(p.buffer),model:{id:"lungmask-R231",version:"0.2.20",weightsSha256:R231_SHA256,modality:"CT",task:"synthetic-contract-test"},labels:[{id:1,name:"test1"},{id:2,name:"test2"}],limitations:["Synthetic contract fixture, not a Lungmask prediction."]};
  t.mock.method(globalThis,"fetch",async(url: string, init: RequestInit)=>{
    calls.push((init.method??"GET")+" "+url);
    assert.equal(new Headers(init.headers).get("Authorization"),`Bearer ${session.token}`);
    assert.equal(init.credentials,"omit");assert.equal(init.redirect,"error");
    if(url.endsWith("capabilities"))return Response.json(caps);
    if(init.method==="POST")return Response.json({jobId});
    if(init.method==="PUT")return Response.json({state:"queued"});
    if(init.method==="DELETE")return new Response(null,{status:204});
    if(url.endsWith("mask"))return new Response(p.buffer,{headers:{"content-length":String(p.buffer.byteLength)}});
    return Response.json({schema:"opus-worker-job-status/v1",jobId,state:"succeeded",result,metrics:{device:"cpu",inferenceSeconds:1,totalSeconds:2,peakRssMiB:3,platform:"synthetic",machine:"fixture"}});
  });
  const out=await runLocalR231(session,p,new AbortController().signal,()=>{});
  assert.deepEqual([...out.mask.data],Array.from({length:18},(_,i)=>i%3));
  assert.equal(calls.at(-1),`DELETE ${session.endpoint}/v1/jobs/${jobId}`);
});

test("wrong source fails before mask import and still releases worker slot",async t=>{
  const p=await packet(),jobId=crypto.randomUUID();let deleted=false;
  t.mock.method(globalThis,"fetch",async(url:string,init:RequestInit)=>{
    if(url.endsWith("capabilities"))return Response.json(caps);
    if(init.method==="POST")return Response.json({jobId});
    if(init.method==="PUT")return Response.json({state:"queued"});
    if(init.method==="DELETE"){deleted=true;return new Response(null,{status:204});}
    return Response.json({schema:"opus-worker-job-status/v1",jobId:crypto.randomUUID(),state:"succeeded"});
  });
  await assert.rejects(runLocalR231(session,p,new AbortController().signal,()=>{}),/другому заданию/);
  assert.equal(deleted,true);
});

test("MR never creates an R231 job",async t=>{
  const p=await packet();p.request.modality="MR";let called=false;
  t.mock.method(globalThis,"fetch",async()=>{called=true;return Response.json(caps);});
  await assert.rejects(runLocalR231(session,p,new AbortController().signal,()=>{}),/только КТ/);
  assert.equal(called,false);
});
