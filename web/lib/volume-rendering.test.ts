import test from "node:test";
import assert from "node:assert/strict";
import { buildVolumeTransfer } from "./volume-rendering.ts";

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
