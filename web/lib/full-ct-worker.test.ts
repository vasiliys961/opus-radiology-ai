import test from "node:test";
import assert from "node:assert/strict";
import {runFullCt,closeFullCt,fullCtReport,loadFullCtSlab} from "./full-ct-worker.ts";
import {R231_SHA256} from "./local-worker.ts";
import type {FullCtStream} from "./full-ct-stream.ts";
import {scalarNiftiHeader,sha256} from "./analysis-package.ts";

const id="11111111-1111-4111-8111-111111111111",session={endpoint:"http://127.0.0.1:8765",token:"synthetic-only-session-token-123456789"};
const packet:FullCtStream={byteLength:1,chunks:async function*(){yield new Uint8Array([1]).buffer;},request:{
  schema:"opus-analysis-request/v2",requestId:id,sourceIdentitySha256:"b".repeat(64),inputSha256:"a".repeat(64),
  geometry:{dimensions:[2,2,40],affineLps:[1,0,0,10,0,1,0,20,0,0,2,-40]},modality:"CT",frameCount:40,
  input:{format:"NIfTI-1",datatype:"float32",scalarValues:"cornerstone-decoded-no-additional-normalization"},
  scope:"selected-series-only",sequence:"not-confirmed",coverage:"not-confirmed"}};
const caps={schema:"opus-worker-capabilities/v1",mode:"local",device:"cpu",dataPolicy:"public-reference-only",patientMode:false,externalEgress:false,
  concurrency:1,maxVoxels:8388608,chunkUpload:{version:1,maxChunkBytes:262144},model:{id:"lungmask-R231",version:"0.2.20",weightsSha256:R231_SHA256,ready:true},
  fullCt:{requestSchema:"opus-analysis-request/v2",maxPlane:512,maxFrames:300,maskAccess:"bounded-slabs-only"}};
const status=()=>({state:"succeeded",result:{schema:"opus-segmentation-result/v1" as const,requestId:id,sourceIdentitySha256:"b".repeat(64),inputSha256:"a".repeat(64),
  maskSha256:"c".repeat(64),model:{id:"lungmask-R231",version:"0.2.20",weightsSha256:R231_SHA256,modality:"CT",task:"synthetic-test"},
  labels:[{id:1,name:"Synthetic"}],limitations:["No medical inference"],fullVolume:{dimensions:[2,2,40],labelVoxels:[30,10],coverage:"all-supplied-frames",clinicalStatus:"unverified_research_draft"}},
  metrics:{device:"cpu",inferenceSeconds:0,totalSeconds:0,peakRssMiB:0,inferenceImplementation:"full-ct-streamed-r231/v2" as const,platform:"secret-must-not-export",machine:"synthetic",token:"do-not-export"}});
test("Completed full job is retained without full-mask download; report excludes token/opaque metrics; explicit delete",async()=>{
  const old=globalThis.fetch;let deleted=0,gotMask=0;
  globalThis.fetch=async(url,options)=>{
    const path=new URL(String(url)).pathname;
    assert.equal((options?.headers as Record<string,string>).Authorization,"Bearer "+session.token);
    const json=(v:unknown)=>new Response(JSON.stringify(v));
    if(path.endsWith("capabilities"))return json(caps);
    if(options?.method==="DELETE"){deleted++;return new Response(null,{status:204});}
    if(path.endsWith("/mask")){gotMask++;throw Error("never download full mask");}
    if(path==="/v1/jobs")return json({jobId:id});
    if(options?.method==="PUT")return json({state:"receiving_chunks",uploadedBytes:1});
    if(path.endsWith("/complete"))return json({state:"queued"});
    return json(status());
  };
  try{const ticket=await runFullCt(session,packet,new AbortController().signal,()=>{});
    assert.equal(deleted,0);assert.equal(gotMask,0);assert.equal(ticket.request.frameCount,40);
    const report=JSON.stringify(fullCtReport(ticket));assert.equal(report.includes(session.token),false);
    assert.equal(report.includes("do-not-export"),false);assert.equal(report.includes("secret-must-not-export"),false);
    await closeFullCt(ticket);assert.equal(deleted,1);
  }finally{globalThis.fetch=old;}
});
test("Wrong full source/model weights are refused and job is deleted",async()=>{
  const old=globalThis.fetch;let deleted=0;
  globalThis.fetch=async(url,options)=>{
    const path=new URL(String(url)).pathname;
    const json=(v:unknown)=>new Response(JSON.stringify(v));
    if(path.endsWith("capabilities"))return json(caps);
    if(options?.method==="DELETE"){deleted++;return new Response(null,{status:204});}
    if(path==="/v1/jobs")return json({jobId:id});
    if(options?.method==="PUT")return json({state:"receiving_chunks",uploadedBytes:1});
    if(path.endsWith("/complete"))return json({state:"queued"});
    const wrong=status();wrong.result.model.weightsSha256="d".repeat(64);return json(wrong);
  };
  try{await assert.rejects(runFullCt(session,packet,new AbortController().signal,()=>{}),/не привязан/);assert.equal(deleted,1);}
  finally{globalThis.fetch=old;}
});
test("Slab proof binds full identity/hash and shifted native geometry; wrong range and hash fail",async()=>{
  const old=globalThis.fetch;
  const s=status(),ticket={session,jobId:id,request:packet.request,result:s.result,labelVoxels:[30,10] as [number,number],metrics:{...s.metrics,device:"cpu" as const}};
  const geometry={dimensions:[2,2,8] as [number,number,number],affineLps:[1,0,0,10,0,1,0,20,0,0,2,-16] as typeof packet.request.geometry.affineLps};
  const {header}=scalarNiftiHeader(geometry),bytes=new Uint8Array(352+32);bytes.set(new Uint8Array(header));bytes.fill(1,352);
  new DataView(bytes.buffer).setInt16(70,2,true);new DataView(bytes.buffer).setInt16(72,8,true);
  const proof={schema:"opus-full-ct-slab/v1",jobId:id,requestId:id,sourceIdentitySha256:"b".repeat(64),inputSha256:"a".repeat(64),
    fullMaskSha256:"c".repeat(64),slabMaskSha256:await sha256(bytes.buffer),geometry,start:12,count:8,sourceFrameCount:40};
  globalThis.fetch=async()=>new Response(bytes,{headers:{"X-Opus-Mask-Proof":btoa(JSON.stringify(proof))}});
  try{const mask=await loadFullCtSlab(ticket,12,8,new AbortController().signal);assert.deepEqual(mask.dimensions,[2,2,8]);
    assert.equal(mask.labels[0].voxels,32);proof.fullMaskSha256="d".repeat(64);
    await assert.rejects(loadFullCtSlab(ticket,12,8,new AbortController().signal),/Чужой/);
    await assert.rejects(loadFullCtSlab(ticket,39,8,new AbortController().signal),/диапазон/);
  }finally{globalThis.fetch=old;}
});
