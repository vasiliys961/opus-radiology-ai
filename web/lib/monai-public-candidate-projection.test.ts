import test from "node:test";
import assert from "node:assert/strict";
import {projectMonaiCandidateHypothesis,projectMonaiCandidateBoundingBox} from "./monai-public-candidate-projection.ts";
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

test("real 3D candidate box covers adjacent native source slices but is not an expert outline",()=>{
  const box=projectMonaiCandidateBoundingBox(base,candidate);
  assert.ok(box);
  assert.deepEqual(box.nativeVoxelBoundingEnvelopeXYZ,
    [124.8,188.16,18.6,131.2,195.84,21.4]);
  assert.deepEqual(box.sourceSliceIndexRangeInclusive,[19,21]);
  assert.equal(box.clinicalLesionSegmentation,false);
  assert.equal(box.independentlyConfirmedTumorVolume,false);
  assert.equal(box.truncatedBySourceVolume,false);
});
test("rotated 3D source orientation uses all eight model world corners",()=>{
  const g={...base,dimensions:[100,100,100],spacingMm:[2,3,4],
    origin:[10,20,30],directionMatrix:[[0,1,0],[-1,0,0],[0,0,1]]};
  const c={...candidate,centerMonaiWorldMm:[19,16,46]};
  const box=projectMonaiCandidateBoundingBox(g,c);
  assert.ok(box);
  assert.deepEqual(box.nativeVoxelBoundingEnvelopeXYZ,
    [0.5,2.1666666666666665,3.125,3.5,3.8333333333333335,4.875]);
  assert.deepEqual(box.sourceSliceIndexRangeInclusive,[3,5]);
});
test("model box clips safely to original public source limits",()=>{
  const g={...base,dimensions:[12,12,12],spacingMm:[1,1,1],origin:[0,0,0]};
  const c={...candidate,centerMonaiWorldMm:[1,1,1],extentMm:[5,6,7]};
  const result=projectMonaiCandidateBoundingBox(g,c);
  assert.ok(result);
  assert.equal(result.truncatedBySourceVolume,true);
  assert.deepEqual(result.nativeVoxelBoundingEnvelopeXYZ,[0,0,0,3.5,4,4.5]);
  assert.equal(projectMonaiCandidateBoundingBox(g,{...c,centerMonaiWorldMm:[100,100,100]}),null);
});
