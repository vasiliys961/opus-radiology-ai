import test from "node:test";
import assert from "node:assert/strict";
import {readyOriginalAbdominalWorker} from "./real-abdominal-worker.ts";
import {prepareDicomCtForPathology} from "./dicom-monai-direct.ts";
import type {DicomSeries} from "./dicom-series.ts";

const sha="a".repeat(64);
const base={
 schema:"opus-original-abdominal-pathology-worker/v1",model:"TotalSegmentator",
 packageVersion:"2.18.0",ready:true,mode:"local-linux-cpu-research",
 sourceFormat:"original-HU-NIfTI",patientMode:false,
 dataPolicy:"public-nonpatient-research-only",
 vendorCheckpointUseCryptographicallyProven:false,
 installedTasks:{kidney_cysts:{checkpointSha256:sha,observedFileVerified:true},
   liver_lesions:{checkpointSha256:sha,observedFileVerified:true},
   pancreatic_tumor:{checkpointSha256:sha,observedFileVerified:true}},
};
test("Three unique existing abdominal pathology tasks are ready only with real local checkpoints",()=>{
 assert.equal(readyOriginalAbdominalWorker(base),true);
 assert.equal(readyOriginalAbdominalWorker({...base,installedTasks:{
  kidney_cysts:{checkpointSha256:sha,observedFileVerified:true}}}),true);
 for(const edited of [
  {ready:false},{patientMode:true},{packageVersion:"3.0.0"},
  {sourceFormat:"PNG"},{model:"SomeMockModel"},
  {installedTasks:{kidney_cysts:{checkpointSha256:"a",observedFileVerified:true}}},
  {installedTasks:{kidney_cysts:{checkpointSha256:sha,observedFileVerified:false}}},
  {installedTasks:{}},{installedTasks:{synthetic:{checkpointSha256:sha,observedFileVerified:true}}},
 ])assert.equal(readyOriginalAbdominalWorker({...base,...edited}),false);
});
test("Native abdominal CT export denies chest, MR and incomplete source before decoding",async()=>{
 const empty:DicomSeries={key:"none",label:"none",modality:"CT",
  members:[],spatiallySorted:false,volumeReady:false,
  sliceSpacingMm:null,warning:null};
 const signal=new AbortController().signal;
 await assert.rejects(
  prepareDicomCtForPathology({...empty,modality:"MR"},[],signal,"ABDOMEN"),
  /DICOM-КТ/);
 await assert.rejects(
  prepareDicomCtForPathology({...empty,members:[{
    id:"x",name:"x.dcm",metadata:{bodyRegion:"CHEST"} as DicomSeries["members"][0]["metadata"],
  }]},[],signal,"ABDOMEN"),/DICOM-КТ/);
});
