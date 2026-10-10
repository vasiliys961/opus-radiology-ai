import test from "node:test";
import assert from "node:assert/strict";
import { createAsyncViewportToggle } from "./async-viewport.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
test("closing during GPU initialization does not resurrect a hidden viewport", async () => {
  const gate = deferred();
  let visible = false;
  const toggle = createAsyncViewportToggle(async isCurrent => {
    await gate.promise;
    if (isCurrent()) visible = true;
  }, () => { visible = false; });
  const opening = toggle.setActive(true);
  await Promise.resolve();
  const closing = toggle.setActive(false);
  gate.resolve();
  assert.equal(await opening, false);
  assert.equal(await closing, false);
  assert.equal(visible, false);
});
test("off/on requests serialize GPU operations and preserve the newest activation", async () => {
  const gate = deferred();
  let running = 0, maximum = 0, activations = 0, visible = false;
  const toggle = createAsyncViewportToggle(async isCurrent => {
    running++; maximum = Math.max(maximum, running); activations++;
    if (activations === 1) await gate.promise;
    if (isCurrent()) visible = true;
    running--;
  }, () => { visible = false; });
  const first = toggle.setActive(true);
  await Promise.resolve();
  const off = toggle.setActive(false);
  const last = toggle.setActive(true);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, off, last]), [false, false, true]);
  assert.equal(maximum, 1);
  assert.equal(visible, true);
});
test("unmount invalidates pending activation and ignores stale GPU errors", async () => {
  const gate = deferred();
  let visible = false;
  const toggle = createAsyncViewportToggle(async () => {
    await gate.promise;
    throw new Error("engine was destroyed");
  }, () => { visible = false; });
  const opening = toggle.setActive(true);
  await Promise.resolve();
  toggle.dispose(); gate.resolve();
  assert.equal(await opening, false);
  assert.equal(await toggle.setActive(true), false);
  assert.equal(visible, false);
});
test("current failures propagate and a later activation can recover", async () => {
  let fail = true;
  const toggle = createAsyncViewportToggle(async () => {
    if (fail) throw new Error("GPU failure");
  }, () => {});
  await assert.rejects(toggle.setActive(true), /GPU failure/);
  fail = false;
  assert.equal(await toggle.setActive(true), true);
});
