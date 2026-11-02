import test from 'node:test';
import assert from 'node:assert/strict';
import {windowDecodedPlane} from './decoded-vision-preview.ts';
test('compressed scalar preview preserves source grid, modality scale and inverse display',()=>{
 const p=windowDecodedPlane([0,50,100],3,1,3,2,-100,0,201,false);
 assert.equal(p.length,12);assert.deepEqual([p[0],p[4],p[8]],[1,128,255]);
 const inverse=windowDecodedPlane([0,50,100],3,1,3,2,-100,0,201,true);
 assert.deepEqual([inverse[0],inverse[4],inverse[8]],[254,127,0]);
 assert.equal(inverse[3],255);
});
test('preview refuses oversized, inconsistent and nonfinite decoded source before PNG',()=>{
 assert.throws(()=>windowDecodedPlane([0,1],2,1,1,1,0,null,null,false));
 assert.throws(()=>windowDecodedPlane([0],2,1,2,1,0,null,null,false));
 assert.throws(()=>windowDecodedPlane([NaN],1,1,1,1,0,null,null,false));
 assert.deepEqual([...windowDecodedPlane([8,9],2,1,2,1,0,null,null,false)],[0,0,0,255,255,255,255,255]);
});
