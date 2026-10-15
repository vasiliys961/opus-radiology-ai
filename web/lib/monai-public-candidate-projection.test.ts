import test from "node:test";
import assert from "node:assert/strict";
import {projectMonaiCandidateHypothesis} from "./monai-public-candidate-projection.ts";
const base={
  dimensions:[512,512,109],spacingMm:[0.78125,0.78125,2.5],
  origin:[-200,-200,-200],directionMatrix:[[1,0,0],[0,1,0],[0,0,1]],
};
const candidate={
  candidateIndex:0,centerMonaiWorldMm:[-100,-50,-150],
  extentMm:[5,6,7],rawClassificationScore:0.981209,
  coordinateFrameVerifiedAgainstSource:false as const,
};
test("research-only candidate projection points to native source slice without establishing a TP",()=>{
  const r=projectMonaiCandidateHypothesis(base,candidate);
  assert.ok(r);
  assert.deepEqual(r.nativeVoxelIndexHypothesis,[128,192,20]);
  assert.equal(r.sourceSliceIndexHypothesis,20);
  assert.equal(r.rawUncalibratedScore,0.981209);
  assert.equal(r.sourceFrameIndependentlyVerified,false);
  assert.equal(r.dicomBound,false);
  assert.equal(r.truePositiveEstablished,false);
  assert.match(r.alignment,/unverified/);
});
test("oblique oriented native index projection uses inverse direction, not naive physical axes",()=>{
  const g={...base,dimensions:[100,100,100],spacingMm:[2,3,4],
    origin:[10,20,30],directionMatrix:[[0,1,0],[-1,0,0],[0,0,1]]};
  const c={...candidate,centerMonaiWorldMm:[19,16,46]};
  const r=projectMonaiCandidateHypothesis(g,c);
  assert.ok(r);
  assert.deepEqual(r.nativeVoxelIndexHypothesis,[2,3,4]);
});
test("out-of-volume hypothesis is not a finding on any source slice",()=>{
  assert.equal(projectMonaiCandidateHypothesis(base,{...candidate,centerMonaiWorldMm:[999,0,0]}),null);
  assert.equal(projectMonaiCandidateHypothesis(base,{...candidate,centerMonaiWorldMm:[-200.1,0,0]}),null);
});
test("invalid geometry, scores and unearned independent verification are rejected",()=>{
  assert.throws(()=>projectMonaiCandidateHypothesis({...base,spacingMm:[0,1,1]},candidate),/spacing/);
  assert.throws(()=>projectMonaiCandidateHypothesis({...base,directionMatrix:[[1,0,0],[1,0,0],[0,0,1]]},candidate),/orientation/);
  assert.throws(()=>projectMonaiCandidateHypothesis(base,{...candidate,rawClassificationScore:1.4}),/candidate/);
  assert.throws(()=>projectMonaiCandidateHypothesis(base,{...candidate,coordinateFrameVerifiedAgainstSource:true as never}),/candidate/);
  assert.throws(()=>projectMonaiCandidateHypothesis(base,{...candidate,centerMonaiWorldMm:[NaN,0,0]}),/center/);
});
