import test from "node:test";
import assert from "node:assert/strict";
import {raidionicsOriginalReady,parseMediastinalNodeReport} from "./mediastinal-raidionics-worker.ts";
const image="a".repeat(64),a="b".repeat(64);
const cap={
 schema:"opus-raidionics-mediastinal-direct-worker/v1",
 model:"Raidionics CT_LymphNodes ONNX v13",
 modelArchiveSHA256:"922c0e99cb637a872d18b83300a648eb0d782b1ef874c5d33a551285e52ccb08",
 lungmaskWeightSHA256:"d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f",
 modelArchiveVerified:true,lungmaskVerified:true,
 raidionicssegVersion:"1.5.2",lungmaskVersion:"0.2.20",
 ready:true,mode:"isolated-private-linux-cpu-research",
 protocol:"contrast-enhanced-chest-CT-confirmed-by-physician",
 patientMode:false,dataPolicy:"public-nonpatient-only",
};
test("Only two authentic installed models may execute one mediastinal node task",()=>{
 assert.equal(raidionicsOriginalReady(cap),true);
 for(const edit of [
  {ready:false},{patientMode:true},{modelArchiveVerified:false},
  {lungmaskVerified:false},{model:"mock-node-detector"},
  {raidionicssegVersion:"1.6.0"},{protocol:"unknown CT"}])
 assert.equal(raidionicsOriginalReady({...cap,...edit}),false);
});
const v={
 schema:"opus-original-raidionics-mediastinal-nodes-native-ct/v1",
 task:"mediastinal_lymph_nodes",sourceNiftiSHA256:image,
 sourceNativeShapeXYZ:[10,10,10],
 originalModelArchiveSHA256:cap.modelArchiveSHA256,
 originalLungmaskSHA256:cap.lungmaskWeightSHA256,
 sourceAlignedLungmaskSHA256:a,modelPredictionNativeMaskSHA256:a,
 actualOriginalRaidionicsInferenceCompleted:true,
 actualOriginalR231InferenceCompleted:true,modelPositiveVoxels:6,
 nodeMalignancyConfirmed:false,clinicalValidation:false,
 negativeLymphadenopathyConclusionPermitted:false,
 sourceDICOMFrameRegistrationVerified:false,
 candidates:[{nativeBoundsIJK:[[1,2],[3,4],[5,6]],
  sourceCentroidIJK:[1.5,3.5,5.5],sourceRASmm:[1.5,3.5,5.5],
  candidateVoxels:6,candidateVolumeMl:.006,nodeMalignancyAssessed:false}],
 limitations:["original model","not validated","native source only"],
};
test("Mediastinal candidate stays native source-bound, never malignancy claim",()=>{
 assert.equal(parseMediastinalNodeReport(v,image,[10,10,10]).candidates.length,1);
 assert.throws(()=>parseMediastinalNodeReport(v,a,[10,10,10]));
 assert.throws(()=>parseMediastinalNodeReport({...v,nodeMalignancyConfirmed:true},image,[10,10,10]));
 assert.throws(()=>parseMediastinalNodeReport({...v,actualOriginalR231InferenceCompleted:false},image,[10,10,10]));
 assert.throws(()=>parseMediastinalNodeReport({...v,candidates:[
  {...v.candidates[0],nativeBoundsIJK:[[1,12],[3,4],[5,6]]}
 ]},image,[10,10,10]));
});
