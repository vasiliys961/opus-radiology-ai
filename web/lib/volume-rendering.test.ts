import test from "node:test";
import assert from "node:assert/strict";
import { applyVolumeDisplay, buildVolumeTransfer, getVolumeSampling, getVolumeScalarRange } from "./volume-rendering.ts";

test("composite curve maps real scalar intensities rather than guessed MR/CT values", () => {
  const curve = buildVolumeTransfer([-850, 3200], 30, 55);
  assert.equal(curve.opacity.at(-1)?.[0], 3200);
  assert.equal(curve.opacity.at(-1)?.[1], 0.55);
  assert.ok(curve.opacity.every(([x,a]) => Number.isFinite(x) && a >= 0 && a <= 1));
  assert.ok(curve.color.every(([,r,g,b]) => [r,g,b].every(v => v >= 0 && v <= 1)));
});
test("threshold and opacity controls are clamped safely", () => {
  const low = buildVolumeTransfer([0, 100], -100, -20);
  const high = buildVolumeTransfer([0, 100], 900, 500);
  assert.equal(low.opacity[0][0], 0);
  assert.equal(low.opacity.at(-1)?.[1], 0.05);
  assert.equal(high.opacity.at(-1)?.[1], 1);
  assert.ok(high.opacity[1][0] <= 85);
});
test("rejects constant or nonfinite ranges", () => {
  assert.throws(() => buildVolumeTransfer([0,0], 20, 40));
  assert.throws(() => buildVolumeTransfer([NaN, 100],20,40));
  assert.throws(() => buildVolumeTransfer([0,100], Infinity,40));
});
test("MIP full-range mapping differs from selected composite cutoff", () => {
  const mip = buildVolumeTransfer([100,900],0,100);
  const composite = buildVolumeTransfer([100,900],45,40);
  assert.ok(mip.opacity[1][0] < composite.opacity[1][0]);
  assert.equal(mip.opacity.at(-1)?.[1], 1);
});

test("reads scalar range from Cornerstone3D 4.x VoxelManager without expanding volume", () => {
  const volume = { voxelManager: { getRange: () => [5, 5095] as [number,number], getScalarData: () => { throw new Error("Must not expand volume"); } } };
  assert.deepEqual(getVolumeScalarRange(volume), [5,5095]);
});
test("falls back to VoxelManager min/max if getRange is unsupported", () => {
  const volume = { voxelManager: { getRange: () => [0,0], getMinMax: () => ({min:-100,max:1200}) } };
  assert.deepEqual(getVolumeScalarRange(volume), [-100,1200]);
});
test("fails closed on unavailable or invalid voxel intensities", () => {
  assert.throws(() => getVolumeScalarRange({}), /VoxelManager/);
  assert.throws(() => getVolumeScalarRange({ voxelManager: {getRange:()=>[NaN,999]} }), /VoxelManager/);
  assert.throws(() => getVolumeScalarRange({ voxelManager: {getRange:()=>[3,3]} }), /VoxelManager/);
});

test("zero cutoff has strictly increasing scalar coordinates for both VTK functions", () => {
  for (const cutoff of [0, 1, 28, 85]) {
    const transfer = buildVolumeTransfer([-1000, 2000], cutoff, 48);
    for (const nodes of [transfer.opacity, transfer.color]) {
      assert.ok(nodes.every(([x], i) => i === 0 || x > nodes[i - 1][0]));
    }
  }
});
test("palette changes colors without changing opacity or original scalar coordinates", () => {
  const neutral = buildVolumeTransfer([50, 1700], 28, 48, "neutral");
  const cool = buildVolumeTransfer([50, 1700], 28, 48, "cool");
  assert.deepEqual(neutral.opacity, cool.opacity);
  assert.ok(neutral.color.every(([, r, g, b]) => r === g && g === b));
  assert.deepEqual(neutral.color.map(n => n[0]), cool.color.map(n => n[0]));
});
test("fine ray sampling accounts for anisotropy without exceeding the ray budget", () => {
  const dimensions = [512, 512, 20], spacing = [0.35, 0.35, 4.5];
  const economy = getVolumeSampling(spacing, dimensions, "economy");
  const fine = getVolumeSampling(spacing, dimensions, "fine");
  assert.ok(fine.sampleDistance < economy.sampleDistance);
  const diagonal = Math.hypot(...spacing.map((s, i) => s * (dimensions[i] - 1)));
  assert.ok(diagonal / fine.sampleDistance <= 3500);
  const large = getVolumeSampling([0.01, 0.01, 50], [2048, 2048, 200], "fine");
  assert.ok(large.sampleDistance >= 9950 / 3500);
});
test("ray sampling rejects missing and invalid geometry", () => {
  assert.throws(() => getVolumeSampling([0, 1, 2], [10, 10, 10], "balanced"));
  assert.throws(() => getVolumeSampling([1, NaN, 2], [10, 10, 10], "balanced"));
  assert.throws(() => getVolumeSampling([1, 1, 2], [10, 10, 1.5], "balanced"));
});
test("MIP and composite set the VTK mapper blend mode; interpolation and sampling are independent", () => {
  const calls: { blend: number[]; samples: number[]; opacity: number[][]; interpolation: number[]; unit: number[][] } =
    { blend: [], samples: [], opacity: [], interpolation: [], unit: [] };
  const actor = {
    getMapper: () => ({
      setBlendMode: (n: number) => { calls.blend.push(n); },
      setSampleDistance: (n: number) => { calls.samples.push(n); },
      setImageSampleDistance: () => {}, setMaximumSamplesPerRay: () => {},
    }),
    getProperty: () => ({
      getScalarOpacity: () => ({ removeAllPoints: () => { calls.opacity = []; }, addPoint: (x: number, a: number) => { calls.opacity.push([x, a]); } }),
      getRGBTransferFunction: () => ({ removeAllPoints: () => {}, addRGBPoint: () => {} }),
      setInterpolationType: (n: number) => { calls.interpolation.push(n); },
      setScalarOpacityUnitDistance: (channel: number, n: number) => { calls.unit.push([channel, n]); },
    }),
  };
  const sampling = getVolumeSampling([1, 1, 4.5], [64, 64, 20], "balanced");
  applyVolumeDisplay(actor, buildVolumeTransfer([0, 1000], 0, 100), { ...sampling, blendMode: 1, interpolationType: 1 });
  applyVolumeDisplay(actor, buildVolumeTransfer([0, 1000], 28, 48), { ...sampling, blendMode: 0, interpolationType: 0 });
  assert.deepEqual(calls.blend, [1, 0]);
  assert.deepEqual(calls.interpolation, [1, 0]);
  assert.deepEqual(calls.samples, [sampling.sampleDistance, sampling.sampleDistance]);
  assert.deepEqual(calls.unit, [[0, 1], [0, 1]]);
  assert.equal(calls.opacity.at(-1)?.[1], 0.48);
});
