import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateStudyCost,opusUsageEstimate} from './study-cost-estimate.ts';
import type {LocalVolumeReceipt} from './full-volume-receipts.ts';
test('forecast uses actual Gemini receipt average after processing, not zero for unprocessed slices',()=>{
 const receipts=[{usage:{inputTokens:4000,outputTokens:1000}}] as LocalVolumeReceipt[];
 const estimate=estimateStudyCost(150,38,receipts,4,true);
 assert.ok(Math.abs(estimate.gemini-(.003+.00375)*150/4)<1e-12);
 assert.ok(estimate.total>estimate.gemini);
 assert.ok(estimateStudyCost(150,38,[],0,true).total>0);
 assert.ok(estimateStudyCost(150,38,[],0,false).total<estimateStudyCost(150,38,[],0,true).total);
 assert.ok(Math.abs(opusUsageEstimate({inputTokens:100,outputTokens:50})-.0014)<1e-12);
});
