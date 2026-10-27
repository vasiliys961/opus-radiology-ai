import { strict as assert } from "node:assert";
import { executeVisionBatches } from "./vision-batch-executor.ts";
import { planBudgetedVisionReview } from "./vision-budget-plan.ts";
import type { EvidenceJson } from "./evidence-json.ts";

const frames=[0,1,2].map(index=>({
  index,seriesUid:"1.2.3",sopInstanceUid:"1.2.3."+index,frameIndex:0,
}));
const evidenceFor=(indices:number[]):EvidenceJson=>({
  schema:"opus-evidence/v1",modality:"CT",coverage:"partially_assessed",
  seriesReviewed:["1.2.3"],warnings:["Research-only 2D review"],
  findings:indices.length?[{
    findingId:"candidate",sign:"unverified focal opacity",anatomy:"lung",
    status:"candidate",source:{seriesUid:"1.2.3",sopInstanceUid:"1.2.3."+indices[0],
      frameIndex:0,slicePositionMm:null},
    measurements:{diameterMm:null,volumeMl:null},
    model:{id:"gemini-research",provider:"openrouter",version:null},
    limitations:["Needs physician review"],
  }]:[],
});
const plan=planBudgetedVisionReview({frameCount:3,maxGeminiUSD:0.30});
const invocations:number[]=[];
const ok=await executeVisionBatches(plan,frames,"CT",async (batch,i)=>{
  invocations.push(i);
  return {evidence:evidenceFor(batch.indices),reviewedIndices:batch.indices,
    usage:{inputTokens:100,outputTokens:30}};
},{maxFramesPerBatch:2});
assert.equal(ok.state,"complete");
assert.deepEqual(invocations,[0,1]);
assert.equal(ok.completedBatches,2);
assert.equal(ok.evidence.findings.length,2);
assert.equal(ok.ledger.processedOverviewFrames,3);
assert.equal(ok.ledger.completedFullOverview,true);
assert.ok(ok.ledger.totalUSD>0);
assert.equal(ok.evidence.findings[0].status,"requires_recheck");

let called=0;
const stopped=await executeVisionBatches(
  planBudgetedVisionReview({frameCount:3,maxGeminiUSD:0.0000001}),
  frames,"CT",async()=>{called++;throw new Error("Should never send");},
  {maxFramesPerBatch:2},
);
assert.equal(stopped.state,"budget_exhausted");
assert.equal(called,0);
assert.equal(stopped.evidence.coverage,"not_assessed");

const foreign=await executeVisionBatches(plan,frames,"CT",
  async(batch)=>({evidence:evidenceFor([2]),reviewedIndices:batch.indices,
    usage:{inputTokens:10,outputTokens:2}}),{maxFramesPerBatch:2});
assert.equal(foreign.state,"interrupted");
assert.equal(foreign.completedBatches,0);
assert.match(foreign.evidence.warnings.join(" "),/Overview incomplete/);

const aborted=new AbortController();aborted.abort();
const cancelled=await executeVisionBatches(plan,frames,"CT",
  async()=>{throw new Error("Must not call");},{signal:aborted.signal});
assert.equal(cancelled.state,"interrupted");
assert.equal(cancelled.completedBatches,0);

const missingReceipt=await executeVisionBatches(plan,frames,"CT",
  async(batch)=>({evidence:evidenceFor(batch.indices),reviewedIndices:batch.indices,
    usage:{inputTokens:-1,outputTokens:2}}));
assert.equal(missingReceipt.state,"interrupted");
assert.equal(missingReceipt.completedBatches,0);
console.log("PASS sequential executor, budget, receipts, source binding, abort");
