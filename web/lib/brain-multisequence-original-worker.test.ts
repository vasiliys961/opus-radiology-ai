import test from "node:test";
import assert from "node:assert/strict";
import {BRAIN_ROLES,readyOriginalBrainTask,parseOriginalBrainReport} from "./brain-multisequence-original-worker.ts";
import {prepareNativeBrainMr} from "./brain-native-mr-dicom.ts";
import type {DicomSeries} from "./dicom-series.ts";
const SHA="a".repeat(64);
const isles="f9023888c7fe616ff271559acb82addd2496581fddd0a94e2d3c80bada5bb7e9";
const brats="860ccb3f1c21c99d0410ad8a1ac4ef6b8fab60cec0a503b0ba42675741a750ae";
const cap={
 schema:"opus-original-brain-multisequence-worker/v1",
 mode:"isolated-linux-cpu-research",patientMode:false,
 dataPolicy:"public-nonpatient-only",originalDICOMWeightingAutoInferred:false,
 ready:true,installedTasks:{
  stroke:{checkpointSha256:isles,installedAndHashVerified:true},
  glioma:{checkpointSha256:brats,installedAndHashVerified:true},
 },
};
test("Original pretrained ISLES and BraTS remain distinct installed MRI pathology tasks",()=>{
 assert.deepEqual(BRAIN_ROLES.stroke,["dwi","adc","flair"]);
 assert.deepEqual(BRAIN_ROLES.glioma,["t1ce","t1","t2","flair"]);
 assert.equal(readyOriginalBrainTask(cap,"stroke"),true);
 assert.equal(readyOriginalBrainTask(cap,"glioma"),true);
 assert.equal(readyOriginalBrainTask({...cap,patientMode:true},"stroke"),false);
 assert.equal(readyOriginalBrainTask({...cap,ready:false},"glioma"),false);
 assert.equal(readyOriginalBrainTask({...cap,
  installedTasks:{stroke:{checkpointSha256:"bad",installedAndHashVerified:true}}},"stroke"),false);
});
const candidate={nativeBoundsIJK:[[1,2],[2,3],[4,5]],
 nativeCenterIJK:[1.5,2.5,4.5],nativeCenterRASmm:[1.5,2.5,4.5],
 candidateVoxels:8,candidateVolumeMl:.008,expertDiagnosisConfirmed:false};
const region={sourcePositiveVoxels:10,components:[candidate]};
const template={
 schema:"opus-original-brain-real-pathology-result/v1",
 task:"stroke",originalCheckpointSha256:isles,
 originalSequenceSha256:{dwi:SHA,adc:SHA,flair:SHA},
 sourceReferenceRole:"dwi",sourceReferenceShapeXYZ:[10,10,10],
 outputNativeSourceGridVerified:true,actualPretrainedModelForwardCompleted:true,
 modelRegions:{ischemic_stroke:region},clinicalValidation:false,
 negativeDiagnosisPermitted:false,originalDICOM_SOPRegistrationVerified:false,
 operatorConfirmedSequenceNamesNotDerivedFromDICOM:true,
 limitations:["original pretrained","operator-confirmed sequences",
  "no clinical validation","not a diagnosis"],
};
test("Reject brain findings from wrong MR sequence, model or no registered source",()=>{
 const source={dwi:SHA,adc:SHA,flair:SHA};
 assert.equal(parseOriginalBrainReport(template,"stroke",source,[10,10,10]).task,"stroke");
 for(const modified of [
  {originalCheckpointSha256:brats},
  {negativeDiagnosisPermitted:true},
  {originalDICOM_SOPRegistrationVerified:true},
  {sourceReferenceRole:"t1ce"},
  {sourceReferenceShapeXYZ:[12,10,10]},
  {modelRegions:{wrong:region}},
  {modelRegions:{ischemic_stroke:{...region,
   components:[{...candidate,nativeBoundsIJK:[[1,20],[2,3],[4,5]]}]}}},
 ])assert.throws(()=>parseOriginalBrainReport({...template,...modified},"stroke",source,[10,10,10]));
 assert.throws(()=>parseOriginalBrainReport(template,"stroke",{dwi:"b".repeat(64),adc:SHA,flair:SHA},[10,10,10]));
});
test("DICOM MR series guard rejects CT and incomplete modality selection before pixel work",async()=>{
 const empty:DicomSeries={key:"empty",label:"empty",modality:"CT",
  members:[],spatiallySorted:false,volumeReady:false,sliceSpacingMm:null,warning:null};
 await assert.rejects(prepareNativeBrainMr(empty,[],"dwi",
  new AbortController().signal),/МРТ/);
});
