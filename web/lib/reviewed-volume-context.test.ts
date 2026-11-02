import test from 'node:test';
import assert from 'node:assert/strict';
import {validateVolumeFrameContext} from './approved-volume-batch-review.ts';
import {planBudgetedVisionReview} from './vision-budget-plan.ts';
import {createVisionBatches} from './vision-batch-ledger.ts';
test('267 source frames plan exactly 67 bounded batches, final 3, without gaps or duplicates',()=>{
 const batches=createVisionBatches(planBudgetedVisionReview({frameCount:267}),4);
 assert.equal(batches.length,67);assert.equal(batches.at(-1)!.indices.length,3);
 assert.deepEqual(batches.flatMap(x=>x.indices),Array.from({length:267},(_,i)=>i));
});
test('only bounded contiguous per-series ordinal context is accepted; no identifiers/free text',()=>{
 assert.equal(validateVolumeFrameContext({totalFrames:267,sliceNumbers:[265,266,267]},3),true);
 for(const v of [{totalFrames:267,sliceNumbers:[1,1]},{totalFrames:267,sliceNumbers:[1,3]},
  {totalFrames:267,sliceNumbers:[268]},{totalFrames:267,sliceNumbers:[1],patientName:'forbidden'},
  {totalFrames:1,sliceNumbers:[0]}])assert.equal(validateVolumeFrameContext(v,v.sliceNumbers.length),false);
});
