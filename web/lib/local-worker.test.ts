import test from "node:test";
import assert from "node:assert/strict";
import { checkLocalWorker, runLocalR231, workerEndpoint, workerFailure, LocalWorkerError, R231_SHA256 } from "./local-worker.ts";
import { scalarNiftiChunks } from "./analysis-stream.ts";
import { sha256, writeScalarNifti, type AnalysisPackage } from "./analysis-package.ts";

const session={endpoint:"http://127.0.0.1:8765",token:"a".repeat(43)};
const caps={schema:"opus-worker-capabilities/v1",mode:"local",device:"cpu",dataPolicy:"public-reference-only",patientMode:false,externalEgress:false,concurrency:1,maxVoxels:8388608,chunkUpload:{version:1,maxChunkBytes:262144},
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
    await assert.rejects(checkLocalWorker(session),/недоступ/);
    t.mock.restoreAll();
  }
});

test("resource errors distinguish memory, disk, model, token and origin; no untrusted detail is displayed",()=>{
  const preflight={availableRamBytes:512*1024**2,requiredRamBytes:1536*1024**2,availableDiskBytes:0,requiredDiskBytes:256*1024**2,guardDecision:"reject-memory"};
  const ram=workerFailure({code:"insufficient_memory",preflight},507);
  assert.equal(ram.code,"insufficient_memory");assert.deepEqual(ram.preflight,preflight);
  assert.match(ram.message,/0\.50 ГиБ.*1\.50 ГиБ/);assert.match(ram.message,/Повторить R231/);
  assert.match(workerFailure({code:"insufficient_disk",preflight:{...preflight,guardDecision:"reject-disk"}},507).message,/места.*диске/);
  assert.match(workerFailure({code:"model_not_ready"},503).message,/веса.*перезапустите/);
  assert.equal(workerFailure("unauthorized",401).code,"unauthorized");
  assert.equal(workerFailure("origin_or_host_denied",403).code,"origin_or_host_denied");
  assert.match(workerFailure({code:"memory_pressure",preflight},500).message,/остановлена.*защиты системы/);
  assert.match(workerFailure({code:"rss_limit"},500).message,/бюджет RAM/);
  const untrusted=workerFailure({code:"sentinel-private-data",preflight:{...preflight,requiredRamBytes:NaN}},500);
  assert.equal(untrusted.code,"worker_http_error");assert.equal(untrusted.preflight,undefined);
  assert.doesNotMatch(untrusted.message,/sentinel-private-data/);
});

test("HTTP 507 is retryable in the same worker session without reserving/deleting a job",async t=>{
  const p=await packet();let attempts=0,deleted=false;
  const preflight={availableRamBytes:512*1024**2,requiredRamBytes:1536*1024**2,availableDiskBytes:1024**3,requiredDiskBytes:256*1024**2,guardDecision:"reject-memory"};
  t.mock.method(globalThis,"fetch",async(url:string,init:RequestInit)=>{
    if(url.endsWith("capabilities"))return Response.json({...caps,resourceProfile:{name:"safe",threads:1,interOpThreads:1}});
    if(init.method==="POST") {
      attempts++;return Response.json({detail:{code:attempts===1?"insufficient_memory":"insufficient_disk",preflight:{...preflight,guardDecision:attempts===1?"reject-memory":"reject-disk"}}},{status:507});
    }
    if(init.method==="DELETE")deleted=true;
    throw Error("Rejected job must not upload input or hold a slot");
  });
  assert.equal(await checkLocalWorker(session),"safe");
  await assert.rejects(runLocalR231(session,p,new AbortController().signal,()=>{}),e=>e instanceof LocalWorkerError&&e.code==="insufficient_memory");
  await assert.rejects(runLocalR231(session,p,new AbortController().signal,()=>{}),e=>e instanceof LocalWorkerError&&e.code==="insufficient_disk");
  assert.equal(attempts,2);assert.equal(deleted,false);
});

test("transport/CORS failure has actionable text, while cancellation remains AbortError",async t=>{
  t.mock.method(globalThis,"fetch",async()=>{throw new TypeError("Failed to fetch");});
  await assert.rejects(checkLocalWorker(session),e=>e instanceof LocalWorkerError&&e.code==="connection_or_cors");
  const controller=new AbortController();controller.abort();
  t.mock.method(globalThis,"fetch",async()=>{throw new DOMException("cancel","AbortError");});
  await assert.rejects(checkLocalWorker(session,controller.signal),{name:"AbortError"});
});

test("synthetic contract fixture returns exact bound mask and deletes job; no medical inference",async t=>{
  for(const transport of ["legacy","chunks","oversized-mask"]){
  const p=await packet(),jobId=crypto.randomUUID(),calls:string[]=[];let uploaded=0;
  const result={schema:"opus-segmentation-result/v1",requestId:p.request.requestId,sourceIdentitySha256:p.request.sourceIdentitySha256,inputSha256:p.request.inputSha256,
    maskSha256:await sha256(p.buffer),model:{id:"lungmask-R231",version:"0.2.20",weightsSha256:R231_SHA256,modality:"CT",task:"synthetic-contract-test"},labels:[{id:1,name:"test1"},{id:2,name:"test2"}],limitations:["Synthetic contract fixture, not a Lungmask prediction."]};
  t.mock.method(globalThis,"fetch",async(url: string, init: RequestInit)=>{
    calls.push((init.method??"GET")+" "+url);
    assert.equal(new Headers(init.headers).get("Authorization"),`Bearer ${session.token}`);
    assert.equal(init.credentials,"omit");assert.equal(init.redirect,"error");
    if(url.endsWith("capabilities"))return Response.json(caps);
    if(url.endsWith("/input/complete")) {assert.equal(uploaded,p.buffer.byteLength);return Response.json({state:"queued"});}
    if(init.method==="POST")return Response.json({jobId});
    if(url.includes("/input/chunks/")) {
      assert.equal(Number(url.split("/").at(-1)),uploaded);
      uploaded+=(init.body as ArrayBuffer).byteLength;
      return Response.json({state:"receiving_chunks",uploadedBytes:uploaded});
    }
    if(init.method==="PUT")return Response.json({state:"queued"});
    if(init.method==="DELETE")return new Response(null,{status:204});
    if(url.endsWith("mask"))return new Response(transport==="oversized-mask"?new Uint8Array(p.buffer.byteLength+1):p.buffer,{headers:{"content-length":String(p.buffer.byteLength)}});
    return Response.json({schema:"opus-worker-job-status/v1",jobId,state:"succeeded",result,metrics:{device:"cpu",inferenceSeconds:1,totalSeconds:2,peakRssMiB:3,platform:"synthetic",machine:"fixture"}});
  });
  const input=transport==="legacy"?p:{request:p.request,byteLength:p.buffer.byteLength,
    chunks:(signal:AbortSignal)=>scalarNiftiChunks(p.request.geometry,i=>i%3,signal)};
  if(transport==="oversized-mask")await assert.rejects(runLocalR231(session,input,new AbortController().signal,()=>{}),/превышает заявленный/);
  else {
  const out=await runLocalR231(session,input,new AbortController().signal,()=>{});
  assert.deepEqual([...out.mask.data],Array.from({length:18},(_,i)=>i%3));
  }
  assert.equal(calls.at(-1),`DELETE ${session.endpoint}/v1/jobs/${jobId}`);
  t.mock.restoreAll();
  }
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

test("bad chunk acknowledgement and cancellation stop scalar production, never complete, and delete job",async t=>{
  for(const failure of ["ack","cancel"]) {
    const p=await packet(),jobId=crypto.randomUUID(),controller=new AbortController();
    let reads=0,completed=false,deleted=false;
    t.mock.method(globalThis,"fetch",async(url:string,init:RequestInit)=>{
      if(url.endsWith("capabilities"))return Response.json(caps);
      if(init.method==="DELETE"){deleted=true;return new Response(null,{status:204});}
      if(url.endsWith("/input/complete")){completed=true;throw Error("must not complete");}
      if(init.method==="POST")return Response.json({jobId});
      if(failure==="cancel"){controller.abort();throw new DOMException("cancel","AbortError");}
      return Response.json({state:"receiving_chunks",uploadedBytes:0});
    });
    const stream={request:p.request,byteLength:p.buffer.byteLength,
      chunks:(signal:AbortSignal)=>scalarNiftiChunks(p.request.geometry,()=>{reads++;return 1;},signal)};
    await assert.rejects(runLocalR231(session,stream,controller.signal,()=>{}));
    assert.equal(reads,0);assert.equal(completed,false);assert.equal(deleted,true);
    t.mock.restoreAll();
  }
});
