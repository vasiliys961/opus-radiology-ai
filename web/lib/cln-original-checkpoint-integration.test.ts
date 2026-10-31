import test from "node:test";
import assert from "node:assert/strict";
import {checkAutomaticClnReady,CLN_ORIGINAL_CHECKPOINT_SHA256} from "./cln-native-worker.ts";
import {assembleSanitizedDetectorBundle} from "./detector-consilium-evidence.ts";
import type {ClnReport} from "./cln-native-worker.ts";

// Numeric example follows genuine 2026-10-29 original CLN forward on public
// MSD lung_043 (Dice .8137 in that separate run). This unit test DOES NOT
// execute a model and must never be cited as clinical validation.
const sourceHash="a".repeat(64);
const report:ClnReport={
 schema:"opus-original-cln-upload-result/v1",
 sourceNiftiSha256:sourceHash,
 realOriginalModelForwardCompleted:true,
 checkpointSha256:CLN_ORIGINAL_CHECKPOINT_SHA256,
 candidateCount:1,
 nativeCandidates:[{candidateVolumeMl:2.303572}],
 researchOnly:true,clinicalValidation:false,negativeDiagnosisPermitted:false,
};
const cap={
 schema:"opus-original-cln-upload-worker/v1",
 modelId:"Lab-Rasool/CLN-Segmenter-MSD-fold0",
 checkpointSha256:CLN_ORIGINAL_CHECKPOINT_SHA256,
 originalWeightsVerified:true,
 imageUpload:true,researchOnly:true,patientMode:false,
};
test("CLN worker is ready ONLY with exact pinned original publisher weights",async()=>{
 const before=globalThis.fetch;
 let reply:Record<string,unknown>={...cap};
 globalThis.fetch=async()=>new Response(JSON.stringify(reply),{status:200});
 try{
  assert.equal(await checkAutomaticClnReady(),true);
  reply={...cap,checkpointSha256:"b".repeat(64)};
  assert.equal(await checkAutomaticClnReady(),false);
  reply={...cap,originalWeightsVerified:false};
  assert.equal(await checkAutomaticClnReady(),false);
  reply={...cap,modelId:"forged-detector"};
  assert.equal(await checkAutomaticClnReady(),false);
 }finally{globalThis.fetch=before;}
});
test("CLN true-positive numeric output enters same-study consilium as lung tumor, not nodules",()=>{
 const bundle=assembleSanitizedDetectorBundle({
  modality:"CT",region:"chest",nativeSourceSha256:sourceHash,cln:report,
 });
 const tumor=bundle.facts.find(f=>f.task==="lung_tumor");
 assert.deepEqual(tumor,{task:"lung_tumor",status:"completed",
  candidateCount:1,candidateVolumeMl:2.304});
 assert.equal(bundle.facts.find(f=>f.task==="lung_nodules")?.status,"not_assessed");
 assert.equal(bundle.sourceIdentifiersSent,false);
 assert.equal(bundle.sourcePixelsSent,false);
 assert.equal(JSON.stringify(bundle).includes(sourceHash),false);
 assert.equal(JSON.stringify(bundle).includes(CLN_ORIGINAL_CHECKPOINT_SHA256),false);
});
test("Forged CLN weight, mismatched source, bad numbers and simulated forward cannot enter consilium",()=>{
 for(const forged of [
  {...report,checkpointSha256:"b".repeat(64)},
  {...report,sourceNiftiSha256:"b".repeat(64)},
  {...report,realOriginalModelForwardCompleted:false},
  {...report,clinicalValidation:true},
  {...report,negativeDiagnosisPermitted:true},
  {...report,nativeCandidates:[{candidateVolumeMl:-1}]},
  {...report,nativeCandidates:[{candidateVolumeMl:Infinity}]},
  {...report,candidateCount:2},
 ]){
  assert.throws(()=>assembleSanitizedDetectorBundle({
   modality:"CT",region:"chest",nativeSourceSha256:sourceHash,
   cln:forged as ClnReport,
  }),/CLN original forward|Модели относятся/);
 }
});
