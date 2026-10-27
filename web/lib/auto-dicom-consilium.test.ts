import {strict as assert} from "node:assert";
import {runAutoDicomConsilium} from "./auto-dicom-consilium.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";
import type {EvidenceJson} from "./evidence-json.ts";
import {planBudgetedVisionReview} from "./vision-budget-plan.ts";
const metadata={modality:"CT",bodyRegion:"CHEST",imageRole:"PRIMARY",
  seriesUid:"1.2.3",sopInstanceUid:"1.2.3.4"} as TechnicalDicomMetadata;
const series:DicomSeries={key:"s",label:"CT",modality:"CT",members:[{id:"a",name:"x",metadata}],
  spatiallySorted:true,volumeReady:true,sliceSpacingMm:1,warning:null};
const e:EvidenceJson={schema:"opus-evidence/v1",modality:"CT",
  coverage:"partially_assessed",seriesReviewed:["1.2.3"],warnings:["test"],
  findings:[{findingId:"candidate",sign:"possible pulmonary nodule",anatomy:"lung",
    status:"candidate",source:{seriesUid:"1.2.3",sopInstanceUid:"1.2.3.4",frameIndex:0,slicePositionMm:1},
    measurements:{diameterMm:null,volumeMl:null},model:{id:"research-detector",
    provider:"local",version:"test"},limitations:[]}]};
const registeredDetectors=[{target:"pulmonary-nodules",modality:"CT" as const,
  eligible:()=>true,run:async()=>e}];
const local=await runAutoDicomConsilium({series,registeredDetectors,authorizedCloudImages:false});
assert.equal(local.state,"local_only");assert.equal(local.consilium,null);
assert.deepEqual(local.detectorDispatch.executed,["pulmonary-nodules"]);
let visualCalls=0,reasoningCalls=0;
const image="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5kAAAAASUVORK5CYII=";
const args={frames:[{index:0,frame:{imageId:"frame-a",mimeType:"image/png" as const,
  base64:image,seriesUid:"1.2.3",sopInstanceUid:"1.2.3.4",frameIndex:0,
  slicePositionMm:1,viewLabel:"axial"}}],plan:planBudgetedVisionReview({frameCount:1}),
  profile:{modality:"CT" as const,regions:["chest" as const]},provider:"openrouter" as const,
  visionModel:"gemini-test",clinicalModel:"opus-test",
  call:async (request:{role:string;messages:Array<{content:unknown}>})=>{
    if(request.role==="vision"){visualCalls++;return {
      usage:{prompt_tokens:50,completion_tokens:25},choices:[{finish_reason:"stop",
      message:{content:JSON.stringify({reviewedImageIds:["frame-a"],observations:[],limitations:[]})}}]};}
    reasoningCalls++;const payload=JSON.parse(String(request.messages[1].content));
    assert.equal(payload.detectorEvidence[0].findings[0].findingId,"candidate");
    return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
      summary:"Unsigned model findings require physician verification",limitations:[]})}}]};
  }};
const combined=await runAutoDicomConsilium({series,registeredDetectors,authorizedCloudImages:args});
assert.equal(combined.state,"complete");assert.equal(visualCalls,1);assert.equal(reasoningCalls,1);
assert.equal(combined.consilium?.detectorEvidence.length,1);
await assert.rejects(()=>runAutoDicomConsilium({series,registeredDetectors,
  authorizedCloudImages:{...args,frames:args.frames.map(x=>({...x,frame:{...x.frame,sopInstanceUid:"foreign"}}))}}));
assert.equal(visualCalls,1);
console.log("PASS local-only default and DICOM-source-bound detectors to Gemini to Opus");
