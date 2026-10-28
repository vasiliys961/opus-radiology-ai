import test from "node:test";
import assert from "node:assert/strict";
import {createNodulePhysicianReview} from "./monai-nodule-physician-review.ts";
import type {NoduleNativeSource,BoundNoduleReport} from "./live-nodule-report.ts";

const affine=[.8,0,0,-150,0,.8,0,-120,0,0,2.5,-200] as const;
const source:NoduleNativeSource={
 dimensions:[8,8,8],affineLps:[...affine],bytesPerVoxel:2,
 datatype:4,bytes:352+8*8*8*2,
};
const report:BoundNoduleReport={
 schema:"opus-monai-bound-nodule-inference/v1",
 source:{format:"NIfTI-1-uncompressed",modality:"CT",anatomy:"CHEST",
   sha256:"a".repeat(64),dimensions:[8,8,8],affineLps:[...affine],
   headerVerified:true,operatorVerifiedFullSelectedSeries:true,
   sourceDICOMIdentityIndependentlyVerified:false},
 model:{id:"monai-lung-nodule-ct-retinanet",version:"0.6.9",
   weightsSha256:"b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01",
   bundleRevision:"7226a40a4c3713f7d5469559b7f2fc296fd54825",
   pretrainedCheckpointReadFromVerifiedBundle:true},
 execution:{type:"isolated-linux-cpu-research",actualPretrainedInferenceCompleted:true,
  modelCalledOnThisExactSource:true,seconds:25,peakProcessRssBytes:4e9,
  cpuPatch:[192,192,80],upstreamEvaluationPatchModified:true},
 candidates:[
  {index:0,score:.88,centerLpsMm:[-147.6,-118.4,-187.5],
    extentModelMm:[7,6,5],nativeVoxelIndexHypothesis:[3,2,5],
    sourceCoordinateFrameIndependentlyVerified:false,clinicalFindingConfirmed:false},
  {index:1,score:.21,centerLpsMm:[-146.8,-117.6,-195],
    extentModelMm:[8,6,4],nativeVoxelIndexHypothesis:[4,3,2],
    sourceCoordinateFrameIndependentlyVerified:false,clinicalFindingConfirmed:false},
 ],
 clinicalStatus:"unverified_research_draft",
 sourceWorldCoordinateFrameIndependentlyVerified:false,
 clinicallyValidated:false,negativeDiagnosisAllowed:false,limitations:["Research only","No external validation","Review"],
};
const date="2026-10-28T07:49:00.000Z";
test("reader assessment of REAL model candidates retains source/model provenance without diagnosis",()=>{
 const result=createNodulePhysicianReview(report,source,{
  0:"suspicious_on_review",1:"dismissed_on_review",
 },date);
 assert.equal(result.totals.suspicious,1);
 assert.equal(result.totals.dismissed,1);
 assert.equal(result.totals.unreviewed,0);
 assert.equal(result.candidates[0].readerDecision,"suspicious_on_review");
 assert.equal(result.candidates[1].readerDecision,"dismissed_on_review");
 assert.deepEqual(result.candidates[0].centerLpsMm,report.candidates[0].centerLpsMm);
 assert.equal(result.source.sha256,"a".repeat(64));
 assert.equal(result.model.version,"0.6.9");
 assert.equal(result.cloudUpload,false);
 assert.equal(result.clinicalNegativeConclusionAllowed,false);
 assert.equal(result.clinicalDiagnosis,null);
 assert.equal(result.readerReviewStatus,"unsigned_research_draft");
});
test("unreviewed candidates remain explicit, never a false negative",()=>{
 const result=createNodulePhysicianReview(report,source,{},date);
 assert.equal(result.totals.all,2);
 assert.equal(result.totals.unreviewed,2);
 assert.equal(result.clinicalNegativeConclusionAllowed,false);
});
test("tampering or stale source cannot produce physician evidence",()=>{
 assert.throws(()=>createNodulePhysicianReview(report,source,{22:"dismissed_on_review"},date));
 assert.throws(()=>createNodulePhysicianReview(report,source,{0:"verified" as never},date));
 assert.throws(()=>createNodulePhysicianReview(report,{...source,dimensions:[8,8,9]}, {},date));
 assert.throws(()=>createNodulePhysicianReview({...report,clinicallyValidated:true as never},source,{},date));
 assert.throws(()=>createNodulePhysicianReview({...report,execution:{
   ...report.execution,actualPretrainedInferenceCompleted:false as never
 }},source,{},date));
 assert.throws(()=>createNodulePhysicianReview(report,source,{},"tomorrow"));
});
test("allowlist strips embedded untrusted patient details rather than exporting them",()=>{
 const extra={...report.candidates[0],patientName:"PRIVATE PATIENT",apiKey:"secret"};
 Object.defineProperty(extra,"hiddenPixels",{get(){throw Error("pixel access forbidden");},enumerable:true});
 const result=createNodulePhysicianReview({...report,candidates:[extra]},source,{},date);
 const text=JSON.stringify(result);
 assert.ok(!text.includes("PRIVATE PATIENT")&&!text.includes("secret")&&!text.includes("hiddenPixels"));
});
