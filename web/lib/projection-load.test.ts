import test from "node:test";
import assert from "node:assert/strict";
import {appendProjections, projectionAddedMessage} from "./projection-load.ts";

test("a later radiograph is kept beside the one already open", () => {
  const result = appendProjections(
    [{sopInstanceUid: "1.1", name: "pa"}],
    [{sopInstanceUid: "1.2", name: "lateral"}],
  );
  assert.equal("error" in result, false);
  if ("error" in result) return;
  assert.deepEqual(result.items.map(item => item.name), ["pa", "lateral"]);
  assert.equal(result.added, 1);
});

test("the same SOP is not added twice and the list stops at eight", () => {
  const existing = [{sopInstanceUid: "1.1", name: "pa"}];
  assert.deepEqual(appendProjections(existing, [{sopInstanceUid: "1.1", name: "pa-again"}]), {
    error: "Эта проекция уже есть в сравнении.",
  });
  const full = Array.from({length: 8}, (_, index) => ({sopInstanceUid: String(index), name: String(index)}));
  const refused = appendProjections(full, [{sopInstanceUid: "new", name: "ninth"}]);
  assert.equal("error" in refused, true);
});

test("the first projection asks for the next one", () => {
  assert.match(projectionAddedMessage(1), /ещё одну/);
  assert.match(projectionAddedMessage(2), /2 проекции/);
});
