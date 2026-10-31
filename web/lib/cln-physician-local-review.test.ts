import test from "node:test";
import assert from "node:assert/strict";
import {bindOriginalClnCandidates} from "./cln-physician-local-review.ts";
import {CLN_ORIGINAL_CHECKPOINT_SHA256,type ClnReport} from "./cln-native-worker.ts";
const report:ClnReport={
 schema:"opus-original-cln-upload-result/v1",
 sourceNiftiSha256:"a".repeat(64),
 checkpointSha256:CLN_ORIGINAL_CHECKPOINT_SHA256,
 realOriginalModelForwardCompleted:true,researchOnly:true,
 clinicalValidation:false,negativeDiagnosisPermitted:false,
 candidateCount:1,nativeCandidates:[{
  modelComponentId:2,sourceVoxelCentroidIJK:[120.3,50.2,4.6],
  candidateVolumeMl:2.303572,
 }],
};
const uids=Array.from({length:10},(_,i)=>"1.2.840.10008."+i);
test("original CLN candidate opens the exact native source DICOM slice",()=>{
 const values=bindOriginalClnCandidates(report,[512,512,10],uids);
 assert.equal(values.length,1);
 assert.deepEqual(values[0],{
  componentId:2,candidateVolumeMl:2.303572,
  sourceVoxelCentroidIJK:[120.3,50.2,4.6],sliceIndex:5,sopInstanceUid:uids[5],
 });
});
test("CLN navigation rejects forged model, invalid source, out-of-volume centroid and duplicate IDs",()=>{
 const mutate=(patch:Record<string,unknown>)=>({...report,...patch} as ClnReport);
 for(const bad of [
  mutate({checkpointSha256:"b".repeat(64)}),
  mutate({sourceNiftiSha256:"invalid"}),
  mutate({realOriginalModelForwardCompleted:false}),
  mutate({candidateCount:2}),
  mutate({nativeCandidates:[{...report.nativeCandidates[0],sourceVoxelCentroidIJK:[0,0,10]}]}),
  mutate({nativeCandidates:[{...report.nativeCandidates[0],sourceVoxelCentroidIJK:[0,0,NaN]}]}),
  mutate({nativeCandidates:[{...report.nativeCandidates[0],candidateVolumeMl:Infinity}]}),
  mutate({candidateCount:2,nativeCandidates:[report.nativeCandidates[0],report.nativeCandidates[0]]}),
 ])assert.throws(()=>bindOriginalClnCandidates(bad,[512,512,10],uids));
 assert.throws(()=>bindOriginalClnCandidates(report,[512,512,10],[...uids.slice(0,-1),uids[0]]));
});
