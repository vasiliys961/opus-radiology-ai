import test from 'node:test';
import assert from 'node:assert/strict';
import { alignCameraWithPoint, crosshairAfterScroll, insideImageExtent, safeSliceIndex } from './mpr-navigation.ts';

test('camera moves only along plane normal, preserving distance and in-plane pan', () => {
  const pose = alignCameraWithPoint([4, 5, 6], [4, 5, 106], [0, 0, 1], [20, 33, 12]);
  assert.deepEqual(pose, {focalPoint:[4,5,12],position:[4,5,112]});
});
test('oblique camera projection uses dot product, not hard-coded patient axes', () => {
  const axis: [number,number,number] = [Math.SQRT1_2, Math.SQRT1_2, 0];
  const pose = alignCameraWithPoint([0,0,0], [0,0,5], axis, [1,1,9]);
  assert.ok(Math.abs(pose.focalPoint[0] - 1) < 1e-10);
  assert.ok(Math.abs(pose.focalPoint[1] - 1) < 1e-10);
  assert.equal(pose.focalPoint[2], 0);
});
test('scroll updates only the normal component of crosshair', () => {
  assert.deepEqual(crosshairAfterScroll([12,20,30], [0,0,10], [0,0,15], [0,0,1]), [12,20,35]);
});
test('scrolled crosshair stays in physical patient space for oblique normals', () => {
  const point = crosshairAfterScroll([1,2,3], [0,0,0], [1,1,0], [Math.SQRT1_2,Math.SQRT1_2,0]);
  assert.ok(Math.abs(point[0] - 2) < 1e-10);
  assert.ok(Math.abs(point[1] - 3) < 1e-10);
  assert.equal(point[2], 3);
});
test('slice index clamps invalid and boundary values', () => {
  assert.equal(safeSliceIndex(-4,20),0);
  assert.equal(safeSliceIndex(100,20),19);
  assert.equal(safeSliceIndex(4.6,20),5);
  assert.equal(safeSliceIndex(NaN,20),0);
  assert.equal(safeSliceIndex(4,0),0);
});
test('pixel locations outside the volume are rejected without snapping to false anatomy', () => {
  assert.equal(insideImageExtent([0,20,10],[100,100,30]),true);
  assert.equal(insideImageExtent([-1,20,10],[100,100,30]),false);
  assert.equal(insideImageExtent([100,20,10],[100,100,30]),false);
  assert.equal(insideImageExtent([NaN,2,4],[100,100,30]),false);
});
