import test from "node:test";
import assert from "node:assert/strict";
import { buildSegmentationEvidence, reviewSegmentationEvidence } from "./segmentation-evidence.ts";
import { sha256, writeScalarNifti, type AnalysisRequest, type SegmentationResult } from "./analysis-package.ts";
import { parseNiftiMask, transformPoint, type MaskGeometry } from "./segmentation-mask.ts";

const geometry: MaskGeometry={dimensions:[3,2,3],affineLps:[0,-2,0,30,1,0,0,20,0,0,-4,10]};
async function fixture(valueAt: (i:number)=>number = i=>i%3) {
  const buffer=await writeScalarNifti(geometry,valueAt),digest=await sha256(buffer),mask=parseNiftiMask(buffer);
  const request: AnalysisRequest={schema:"opus-analysis-request/v1",requestId:crypto.randomUUID(),sourceIdentitySha256:"b".repeat(64),
    inputSha256:digest,geometry,modality:"CT",frameCount:3,input:{format:"NIfTI-1",datatype:"float32",scalarValues:"cornerstone-decoded-no-additional-normalization"},
    scope:"selected-series-only",sequence:"not-confirmed",coverage:"not-confirmed"};
  const result: SegmentationResult={schema:"opus-segmentation-result/v1",requestId:request.requestId,sourceIdentitySha256:request.sourceIdentitySha256,inputSha256:digest,
    maskSha256:digest,model:{id:"synthetic-unit-fixture",version:"1",weightsSha256:"a".repeat(64),modality:"CT",task:"fixture-only"},
    labels:[{id:1,name:"Synthetic one"},{id:2,name:"Synthetic two"},{id:3,name:"Absent label"}],limitations:["Synthetic labels, no medical inference."]};
  return {mask,request,result,digest};
}

test("bound evidence counts exact native voxels/volume and navigates to occupied LPS points",async()=>{
  const {mask,request,result,digest}=await fixture();
  const original=[...mask.data];
  const e=await buildSegmentationEvidence(request,result,mask,digest,{executionMode:"local"});
  assert.equal(e.clinicalStatus,"unverified_research_draft");assert.equal(e.source.coverage,"not-confirmed");
  assert.equal(e.producer.kind,"specialist-model");assert.equal(e.producer.executionMode,"local");
  assert.equal(e.observations.length,2); // no invented zero-volume absent anatomy
  for(const o of e.observations) {
    assert.equal(o.voxels,6);assert.equal(o.volumeMl,0.048);
    assert.equal(o.review,"unreviewed");
    const [x,y,z]=transformPoint(mask.inverseLps,o.anchorLpsMm);
    assert.equal(mask.data[x+3*(y+2*z)],o.labelId);
  }
  assert.deepEqual(e.observations[0].boundsMaskIndex,{min:[1,0,0],max:[1,1,2]});
  assert.deepEqual([...mask.data],original);
  // Snapshot contains metadata only and does not retain mutable input geometry.
  assert.notEqual(e.source.geometry.affineLps,request.geometry.affineLps);
  assert.notEqual(e.mask.geometry.dimensions,mask.dimensions);
  assert.equal("data" in e.mask,false);
  assert.equal("confidence" in e.observations[0],false);
});

test("evidence rejects wrong request/input/mask binding and mismatched physical grid",async()=>{
  const {mask,request,result,digest}=await fixture();
  for(const key of ["requestId","sourceIdentitySha256","inputSha256"] as const)
    await assert.rejects(buildSegmentationEvidence(request,{...result,[key]:key==="requestId"?crypto.randomUUID():"c".repeat(64)},mask,digest),/другому пакету/);
  await assert.rejects(buildSegmentationEvidence(request,result,mask,"c".repeat(64)),/сумма маски/);
  await assert.rejects(buildSegmentationEvidence(request,{...result,labels:[]},mask,digest),/словаре/);
  await assert.rejects(buildSegmentationEvidence(request,result,{...mask,affineLps:[0,-2,0,31,1,0,0,20,0,0,-4,10]},digest),/Положение/);
  await assert.rejects(buildSegmentationEvidence(request,result,{...mask,data:mask.data.subarray(1)},digest),/размер/);
});

test("empty mask produces no observations or normal diagnosis, imported runtime is not invented",async()=>{
  const {mask,request,result,digest}=await fixture(()=>0);
  const e=await buildSegmentationEvidence(request,result,mask,digest);
  assert.deepEqual(e.observations,[]);assert.equal(e.producer.executionMode,"not-recorded");
  assert.match(e.limitations.join(" "),/не является.*отрицательным/);
});

test("bounded scanning yields and cancellation prevents a partial evidence result",async()=>{
  const {request,result}=await fixture();
  const g: MaskGeometry={dimensions:[100,100,4],affineLps:[1,0,0,0,0,1,0,0,0,0,1,0]};
  const buffer=await writeScalarNifti(g,()=>1),digest=await sha256(buffer),mask=parseNiftiMask(buffer);
  const boundResult={...result,maskSha256:digest};
  const r={...request,geometry:g,frameCount:4};
  const controller=new AbortController();let yields=0;
  await assert.rejects(buildSegmentationEvidence(r,boundResult,mask,digest,{signal:controller.signal,yieldControl:async()=>{yields++;controller.abort();}}),{name:"AbortError"});
  assert.equal(yields,1);
  await assert.rejects(buildSegmentationEvidence(r,boundResult,mask,digest,{signal:controller.signal}),{name:"AbortError"});
});

test("local review is immutable and cannot imply human verification/signature",async()=>{
  const {mask,request,result,digest}=await fixture();
  const e=await buildSegmentationEvidence(request,result,mask,digest);
  const id=e.observations[0].observationId;
  const reviewed=reviewSegmentationEvidence(e,id,"rejected");
  assert.equal(e.observations[0].review,"unreviewed");
  assert.equal(reviewed.observations[0].review,"rejected");
  assert.equal(reviewed.observations[1].review,"unreviewed");
  assert.equal(reviewed.clinicalStatus,"unverified_research_draft");
  assert.equal(reviewSegmentationEvidence(reviewed,id,"unreviewed").observations[0].review,"unreviewed");
  assert.throws(()=>reviewSegmentationEvidence(e,"missing","rejected"));
  assert.throws(()=>reviewSegmentationEvidence(e,id,"verified_by_human" as never));
});

test("metadata export allowlists properties, excludes buffers/secrets and provider calls",async t=>{
  const {mask,request,result,digest}=await fixture();
  t.mock.method(globalThis,"fetch",async()=>{throw Error("Evidence must stay local");});
  const e=await buildSegmentationEvidence({...request,patientName:"private-sentinel",token:"secret-sentinel"} as AnalysisRequest,
    {...result,providerKey:"secret-sentinel"} as SegmentationResult,mask,digest);
  const json=JSON.stringify(e);
  assert.doesNotMatch(json,/private-sentinel|secret-sentinel|Uint16Array/);
  assert.equal(e.mask.sha256,digest);assert.equal(e.producer.model.weightsSha256,result.model.weightsSha256);
});
