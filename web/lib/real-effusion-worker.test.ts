import test from "node:test";
import assert from "node:assert/strict";
import {readyEffusionTask315} from "./real-effusion-worker.ts";
import {planNativeStudyAnalysis} from "./unified-study-dispatch.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";

const h="a".repeat(64);
const cap={
 schema:"opus-original-task315-loopback/v1",task:"pleural_pericard_effusion",
 model:"TotalSegmentator",packageVersion:"2.18.0",
 checkpointFileSha256:h,checkpointFileVerified:true,
 checkpointActiveVendorLoaderVerified:false,
 originalPretrainedTaskAvailable:true,ready:true,mode:"local-linux-cpu-research",
 patientMode:false,dataPolicy:"public-nonpatient-research-only",
 sourceFormat:"original-HU-NIfTI",
};
test("Only original available task315 can be scheduled",()=>{
 assert.equal(readyEffusionTask315(cap),true);
 for(const changes of [
  {ready:false},{patientMode:true},{packageVersion:"3.0.0"},
  {model:"SomeMockModel"},{task:"total"},{checkpointFileSha256:"a"},
  {checkpointFileVerified:false},{originalPretrainedTaskAvailable:false},
  {sourceFormat:"PNG"},{dataPolicy:"patient-data-enabled"}]){
  assert.equal(readyEffusionTask315({...cap,...changes}),false);
 }
});
test("Chest plan uses one task315 for two distinct fluid labels, without second nodule executor",()=>{
 const series:DicomSeries={key:"p",label:"public",modality:"CT",
  spatiallySorted:true,volumeReady:true,sliceSpacingMm:1,warning:null,
  members:Array.from({length:14},(_,i)=>({id:"f"+i,name:"f"+i+".dcm",
   metadata:{bodyRegion:"CHEST",modality:"CT",studyUid:"1.2.3",
    seriesUid:"1.2.3.4",sopInstanceUid:"1.2.3.4."+i,
    imageRole:"PRIMARY",numberOfFrames:1} as TechnicalDicomMetadata}))};
 const plan=planNativeStudyAnalysis(series,new Set(series.members.map(x=>x.id)));
 assert.equal(plan.route,"monai-nodules");
 assert.match(plan.title,/MONAI/);
 assert.match(plan.title,/task315/);
 const altered={...series,members:series.members.map((m,i)=>i===4?{
  ...m,metadata:{...m.metadata,bodyRegion:"ABDOMEN" as const}}:m)};
 assert.equal(planNativeStudyAnalysis(altered,new Set(altered.members.map(x=>x.id))).route,null);
});
