import { strict as assert } from "node:assert";
import { runSpecialistConsilium } from "./specialist-consilium-executor.ts";
import type { CompletionCaller, VisionInput } from "./vision-orchestra.ts";
const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5kAAAAASUVORK5CYII=";
const input:VisionInput={provider:"openrouter",visionModel:"gemini-test",clinicalModel:"opus-test",
  modality:"CT",frames:[{imageId:"frame-1",mimeType:"image/png",base64:png,
  seriesUid:"1.2.3",sopInstanceUid:"1.2.3.4",frameIndex:0,slicePositionMm:12,viewLabel:"axial"}]};
const calls:string[]=[];
const call:CompletionCaller=async request=>{
  calls.push(request.role);
  if(request.role==="vision"){
    const system=String(request.messages[0].content);
    assert.match(system,/source-linked frames/);
    assert.equal(JSON.stringify(request.messages).includes("specialist-detector-placeholder"),false);
    return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
      reviewedImageIds:["frame-1"],observations:[{id:"a",imageId:"frame-1",
        anatomy:"lung",sign:"focal opacity",uncertainty:"single 2D slice"}],limitations:["limited coverage"],
    })}}]};
  }
  const payload=String(request.messages[1].content);
  assert.match(payload,/focal opacity/);
  assert.match(payload,/specialist-detector-placeholder/);
  assert.match(String(request.messages[0].content),/coordinating radiology consultant/);
  return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
    summary:"Unsigned draft: visual opacity and independent detector evidence require review.",
    limitations:["Source frames are incomplete"],
  })}}]};
};
const detectorEvidence={
  schema:"opus-evidence/v1" as const,modality:"CT" as const,
  coverage:"partially_assessed" as const,seriesReviewed:["1.2.3"],warnings:[],
  findings:[{findingId:"specialist-detector-placeholder",sign:"candidate finding",anatomy:"lung",
    status:"candidate" as const,
    source:{seriesUid:"1.2.3",sopInstanceUid:"1.2.3.4",frameIndex:0,slicePositionMm:12},
    measurements:{diameterMm:null,volumeMl:null},
    model:{id:"detector",provider:"research" as const,version:null},limitations:["experimental"]}],
};
const result=await runSpecialistConsilium(input,{modality:"CT",regions:["chest"]},[detectorEvidence],call);
assert.deepEqual(calls,["vision","vision","reasoning"]);
assert.deepEqual(result.specialists,["thoracic","vascular"]);
assert.equal(result.visionEvidence.findings.length,2);
assert.equal(result.visionEvidence.findings[0].source.sopInstanceUid,"1.2.3.4");
assert.equal(result.visionEvidence.findings[0].status,"requires_recheck");
assert.equal(result.detectorEvidence.length,1);
assert.equal(result.status,"unverified_research_draft");
await assert.rejects(()=>runSpecialistConsilium(input,{modality:"MR",regions:["brain"]},[],call));
let count=0;
const invalid:CompletionCaller=async()=>{count++;return {choices:[{finish_reason:"stop",
  message:{content:JSON.stringify({reviewedImageIds:["unknown"],observations:[],limitations:[]})}}]};};
await assert.rejects(()=>runSpecialistConsilium(input,{modality:"CT",regions:["chest"]},[],invalid));
assert.equal(count,1);
console.log("PASS specialist vision dispatch, independent detector evidence, Opus synthesis and source checks");
