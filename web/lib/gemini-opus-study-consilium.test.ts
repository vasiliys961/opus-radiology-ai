import { strict as assert } from "node:assert";
import { runGeminiOpusStudyConsilium } from "./gemini-opus-study-consilium.ts";
import { planBudgetedVisionReview } from "./vision-budget-plan.ts";
const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5kAAAAASUVORK5CYII=";
const images=[0,1,2].map(index=>({index,frame:{
 imageId:"f"+index,mimeType:"image/png" as const,base64:png,
 seriesUid:"1.2.3",sopInstanceUid:"1.2.3."+index,
 frameIndex:0,slicePositionMm:index,viewLabel:"axial",
}}));
let vision=0,reasoning=0;
const result=await runGeminiOpusStudyConsilium({
 plan:planBudgetedVisionReview({frameCount:3}),images,
 profile:{modality:"CT",regions:["chest"]},detectorEvidence:[],
 provider:"openrouter",visionModel:"gemini-test",clinicalModel:"opus-test",maxFramesPerBatch:2,
 call:async request=>{
   if(request.role==="vision"){
     vision++;
     const pieces=request.messages[1].content as Array<Record<string,unknown>>;
     const ids=pieces.filter(x=>x.type==="text").map(x=>String(x.text).split(" ")[2]);
     return {usage:{prompt_tokens:120,completion_tokens:32},
       choices:[{finish_reason:"stop",message:{content:JSON.stringify({
         reviewedImageIds:ids,observations:[{
           id:"opacity",imageId:ids[0],anatomy:"lung",sign:"unverified finding",
           uncertainty:"2D frame only"}],limitations:["sampled frames only"],
         })}}]};
   }
   reasoning++;
   const context=JSON.parse(String(request.messages[1].content));
   assert.equal(context.visionEvidence.findings.length,2);
   assert.equal(context.completedBatches,2);
   assert.equal(context.visionEvidence.coverage,"partially_assessed");
   return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
     summary:"Unsigned clinician-editable research draft",limitations:["partial frame review"],
   })}}]};
 }});
assert.equal(vision,2);
assert.equal(reasoning,1);
assert.equal(result.batch.ledger.processedOverviewFrames,3);
assert.equal(result.batch.evidence.findings[0].source.sopInstanceUid,"1.2.3.0");
assert.equal(result.clinicalStatus,"unverified_research_draft");
await assert.rejects(()=>runGeminiOpusStudyConsilium({
 plan:planBudgetedVisionReview({frameCount:3}),images:[...images].reverse(),
 profile:{modality:"CT",regions:["chest"]},detectorEvidence:[],
 provider:"openrouter",visionModel:"gemini-test",clinicalModel:"opus-test",
 call:async()=>{throw new Error("must not call");},
}));
console.log("PASS fully composed Gemini batches, DICOM evidence and single Opus draft");
