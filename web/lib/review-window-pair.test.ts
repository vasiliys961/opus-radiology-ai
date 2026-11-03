import test from 'node:test';
import assert from 'node:assert/strict';
import {pairReviewWindows} from './review-window-pair.ts';
test('window pairs preserve each source row and side without cropping or interpolation',()=>{
 const a=Uint8ClampedArray.from([1,1,1,255,2,2,2,255]),b=Uint8ClampedArray.from([3,3,3,255,4,4,4,255]);
 const result=pairReviewWindows(a,b,1,2,4);
 assert.equal(result.width,2);assert.equal(result.height,2);
 assert.deepEqual([...result.pixels],[1,1,1,255,3,3,3,255,2,2,2,255,4,4,4,255]);
 assert.throws(()=>pairReviewWindows(a,b,1,2,3));
});
