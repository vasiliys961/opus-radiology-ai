import { strict as assert } from "node:assert";
import { runBudgetedBatchConsilium } from "./batch-consilium-bridge.ts";
import { planBudgetedVisionReview } from "./vision-budget-plan.ts";
import type { EvidenceJson } from "./evidence-json.ts";
import type { CompletionCaller } from "./vision-orchestra.ts";
const frames=[0,1,2].map(index=>({index,seriesUid:"1.2.3",sopInstanceUid:"1.2.3."+index,frameIndex:0}));
let reports=0;
const call:CompletionCaller=async request=>{
  reports++;
  assert.equal(request.role,"reasoning");
  const data=JSON.parse(String(request.messages[1].content));
  assert.equal(data.completedBatches,2);
  assert.equal(data.plannedFrames,3);
  assert.equal(data.visionEvidence.findings.length,2);
  assert.equal(data.detectorEvidence.length,0);
  return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
    summary:"Unsigned evidence-limited research draft",limitations:["Unvalidated"],
  })}}]};
};
const evidence=(i:number):EvidenceJson=>({
  schema:"opus-evidence/v1",modality:"CT",coverage:"partially_assessed",
  seriesReviewed:["1.2.3"],warnings:["research"],
  findings:[{findingId:"f",sign:"visible candidate",anatomy:"lung",
    status:"candidate",source:{seriesUid:"1.2.3",sopInstanceUid:"1.2.3."+i,
      frameIndex:0,slicePositionMm:null},
    measurements:{diameterMm:null,volumeMl:null},
    model:{id:"test",provider:"research",version:null},limitations:[]}],
});
const base={provider:"openrouter" as const,clinicalModel:"opus-test",call,maxFramesPerBatch:2};
const result=await runBudgetedBatchConsilium(
  planBudgetedVisionReview({frameCount:3}),frames,{modality:"CT",regions:["chest"]},[],
  async batch=>({evidence:evidence(batch.indices[0]),reviewedIndices:batch.indices,
    usage:{inputTokens:100,outputTokens:20}}),base);
assert.equal(result.batch.state,"complete");
assert.equal(result.batch.ledger.completedFullOverview,true);
assert.equal(result.clinicalStatus,"unverified_research_draft");
assert.equal(reports,1);
assert.deepEqual(result.specialists,["thoracic","vascular"]);
const denied=await runBudgetedBatchConsilium(
  planBudgetedVisionReview({frameCount:3,maxGeminiUSD:0.00000001}),
  frames,{modality:"CT",regions:["chest"]},[],
  async()=>{throw new Error("Must not call");},base);
assert.equal(denied.batch.state,"budget_exhausted");
assert.equal(denied.clinicalStatus,"not_generated");
assert.equal(reports,1);
await assert.rejects(()=>runBudgetedBatchConsilium(
  planBudgetedVisionReview({frameCount:3}),frames,{modality:"MR",regions:["brain"]},[],
  async()=>{throw new Error("No network");},base));
console.log("PASS batch consilium evidence, single Opus call, no-report on zero coverage and modality guard");
