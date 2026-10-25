import { strict as assert } from "node:assert";
import { planBudgetedVisionReview } from "./vision-budget-plan.ts";
import { createVisionBatches, accountReportedVisionUsage } from "./vision-batch-ledger.ts";

const p=planBudgetedVisionReview({frameCount:25,flaggedIndices:[12],maxGeminiUSD:0.01});
const batches=createVisionBatches(p,10);
assert.deepEqual(batches.map(x=>[x.pass,x.indices.length]),[
  ["overview",10],["overview",10],["overview",5],["targeted",5],
]);
let ledger=accountReportedVisionUsage(p,batches,[{batchIndex:0,usage:{inputTokens:1000,outputTokens:100}}]);
assert.equal(ledger.processedOverviewFrames,10);
assert.equal(ledger.completedFullOverview,false);
assert.equal(ledger.transmissionPermitted,false);
assert.equal(ledger.stopBeforeNextBatch,false);
const receipts=batches.map((_,batchIndex)=>({batchIndex,usage:{inputTokens:10000,outputTokens:1000}}));
ledger=accountReportedVisionUsage(p,batches,receipts);
assert.equal(ledger.completedFullOverview,true);
assert.equal(ledger.processedTargetedFrames,5);
assert.equal(ledger.stopBeforeNextBatch,true);
assert.throws(()=>accountReportedVisionUsage(p,batches,[receipts[1]]));
assert.throws(()=>accountReportedVisionUsage(p,batches,[receipts[0],receipts[0]]));
assert.throws(()=>createVisionBatches(p,33));
console.log("PASS offline batch receipts and strict budget guard");
