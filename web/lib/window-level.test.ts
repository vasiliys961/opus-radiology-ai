import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CT_WINDOW_PRESETS, clampZoom, rangeToWindowLevel, windowLevelToRange } from './window-level.ts';

test('CT brain preset maps to VOI range in rescaled display units', () => {
  const { width, center } = CT_WINDOW_PRESETS.brain;
  assert.deepEqual(windowLevelToRange(width, center), { lower: 0, upper: 80 });
});

test('lung preset supports negative window center', () => {
  assert.deepEqual(windowLevelToRange(1500, -600), { lower: -1350, upper: 150 });
});

test('window range round trip preserves center and width', () => {
  const wl = { width: 400.5, center: 42.25 };
  assert.deepEqual(rangeToWindowLevel(windowLevelToRange(wl.width, wl.center)), wl);
});

test('invalid inputs fail closed instead of corrupting display', () => {
  for (const value of [NaN, Infinity, -2, 0, 1e20]) {
    assert.throws(() => windowLevelToRange(value, 40));
  }
  assert.throws(() => windowLevelToRange(400, Infinity));
  assert.equal(rangeToWindowLevel({ lower: 3, upper: 1 }), null);
});

test('zoom limited to safe UI values', () => {
  assert.equal(clampZoom(0.01), 0.25);
  assert.equal(clampZoom(15), 8);
  assert.equal(clampZoom(NaN), 1);
  assert.equal(clampZoom(1.5), 1.5);
});
