import test from "node:test";
import assert from "node:assert/strict";
import {readyOriginalPeCtpWorker,parseOriginalPeCtpReport} from "./pe-ctpa-direct-worker.ts";
const sha="a".repeat(64),source="b".repeat(64);
const cap={
 schema:"opus-original-pe-ctpa-worker/v1",
 model:"Mazurowski PE nnUNet ResidualEncoderUNet",
 publisherCodeRevision:"b4c50008bbbf825282ccf10767f819276e320fb9",
 modelReleaseReference:"7ce235f",weightFileSha256:sha,originalWeightFileObserved:true,
 ready:true,protocol:"CTPA-only",mode:"isolated-linux-cpu-research",
 patientMode:false,dataPolicy:"approved-public-nonpatient-only",
 vendorActiveParametersCryptographicallyProven:false,
};
test("PE model is unavailable to all unconfirmed model/runtime protocols",()=>{
 assert.equal(readyOriginalPeCtpWorker(cap),true);
 for(const change of [
  {patientMode:true},{ready:false},{modelReleaseReference:"bad"},
  {weightFileSha256:"bad"},{originalWeightFileObserved:false},
  {protocol:"CT"},{mode:"browser-mock"},
  {vendorActiveParametersCryptographicallyProven:true}]){
  assert.equal(readyOriginalPeCtpWorker({...cap,...change}),false);
 }
});
const result={
 schema:"opus-original-mazurowski-ctpa-pe-source/v1",
 task:"pulmonary_embolism_ctpa",sourceNiftiSHA256:source,
 observedModelWeightFileSHA256:sha,sourceNativeShapeXYZ:[10,10,10],
 sourceNativeVoxelPositiveCount:10,realOriginalPretrainedForwardCompleted:true,
 protocolConfirmedByOperatorNotDICOM:true,
 clinicalValidation:false,negativeDiagnosisPermitted:false,
 independentHoldout:false,sourceSOPRegistrationVerified:false,
 lesions:[{nativeVoxelBoundsIJK:[[1,2],[2,4],[3,5]],
  sourceCentroidIJK:[1.5,3,4],sourceRASmm:[1.5,3,4],
  modelCandidateVoxels:10,modelCandidateMl:.01,confirmedEmbolism:false}],
 limitations:["public only","not validated","not diagnosis"],
};
test("native PE candidate requires exact source, verified label bounds and nonclinical status",()=>{
 assert.equal(parseOriginalPeCtpReport(result,source,sha,[10,10,10]).lesions.length,1);
 assert.throws(()=>parseOriginalPeCtpReport(result,"f".repeat(64),sha,[10,10,10]));
 assert.throws(()=>parseOriginalPeCtpReport({...result,clinicalValidation:true},source,sha,[10,10,10]));
 assert.throws(()=>parseOriginalPeCtpReport({...result,negativeDiagnosisPermitted:true},source,sha,[10,10,10]));
 assert.throws(()=>parseOriginalPeCtpReport({...result,lesions:[{
  ...result.lesions[0],nativeVoxelBoundsIJK:[[1,12],[2,4],[3,5]],
 }]},source,sha,[10,10,10]));
});
