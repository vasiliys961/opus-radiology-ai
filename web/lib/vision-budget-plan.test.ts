import { strict as assert } from "node:assert";
import { planBudgetedVisionReview } from "./vision-budget-plan";

const normal = planBudgetedVisionReview({frameCount:300,flaggedIndices:[0,10,299]});
assert.equal(normal.overviewIndices.length,300);
assert.deepEqual(normal.targetedIndices,[0,1,2,8,9,10,11,12,297,298,299]);
assert.equal(normal.overviewCoversAllFrames,true);
assert.equal(normal.transmissionPermitted,false);
assert.equal(normal.deidentificationVerified,false);
assert.equal(normal.requiresExplicitBudgetApproval,false);
const expensive = planBudgetedVisionReview({frameCount:1000,overviewTokensPerFrame:1120});
assert.equal(expensive.requiresExplicitBudgetApproval,true);
assert.equal(expensive.overviewIndices.length,1000);
assert.throws(()=>planBudgetedVisionReview({frameCount:10,flaggedIndices:[10]}));
assert.throws(()=>planBudgetedVisionReview({frameCount:0}));
console.log("vision budget contract PASS (no patient pixels/network calls)");
