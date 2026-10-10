import test from "node:test";
import assert from "node:assert/strict";
import { uniqueNewFiles } from "./study-files.ts";

const f = (name: string, size: number, lastModified = 123, webkitRelativePath = "") =>
  ({ name, size, lastModified, webkitRelativePath });

test("re-selecting the same folder never duplicates an existing DICOM", () => {
  const originals = [f("image-1.dcm", 310000), f("image-2.dcm", 290000)];
  const result = uniqueNewFiles(originals, [...originals]);
  assert.equal(result.duplicates, 2);
  assert.deepEqual(result.newFiles, []);
});
test("different local files and acquisition folders remain distinct", () => {
  const first = f("image-1.dcm", 310000, 123, "seriesA/image-1.dcm");
  const second = f("image-1.dcm", 310000, 123, "seriesB/image-1.dcm");
  const result = uniqueNewFiles([first], [second]);
  assert.equal(result.newFiles.length, 1);
  assert.equal(result.duplicates, 0);
});
test("duplicates within the incoming selection do not inflate M1 guardrails", () => {
  const one = f("a.dcm", 4000);
  const result = uniqueNewFiles([], [one, one, f("b.dcm", 5000), one]);
  assert.equal(result.duplicates, 2);
  assert.deepEqual(result.newFiles.map(f => f.name), ["a.dcm", "b.dcm"]);
});
test("same name but changed size or modification time is not silently discarded", () => {
  const a = f("image.dcm", 1000, 1);
  const b = f("image.dcm", 1100, 1);
  const c = f("image.dcm", 1000, 2);
  assert.equal(uniqueNewFiles([a], [b, c]).newFiles.length, 2);
});
