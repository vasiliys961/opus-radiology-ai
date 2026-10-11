import test from "node:test";
import assert from "node:assert/strict";
import { planVisionFrameSamples, uniformIndices } from "./vision-frame-plan.ts";
import type { DicomSeries, TechnicalDicomMetadata } from "./dicom-series.ts";

function series(count = 32, overrides: Partial<TechnicalDicomMetadata> = {},
                flags: Partial<DicomSeries> = {}): DicomSeries {
  const uid = "2.25.1043521000001";
  const members = Array.from({length: count}, (_, i) => ({
    id: "synthetic-" + i, name: "synthetic-" + i + ".dcm",
    metadata: {
      sopInstanceUid: uid + ".4." + (i + 1),
      studyUid: uid, seriesUid: uid + ".2", frameOfReferenceUid: uid + ".3",
      modality: "MR", numberOfFrames: 1, instanceNumber: i + 1,
      rows: 64, columns: 64, imagePositionPatient: [0, 0, -31 + i * 2],
      imageOrientationPatient: [1, 0, 0, 0, 1, 0], pixelSpacing: [1, 1],
      transferSyntax: "1.2.840.10008.1.2.1", ...overrides,
    } as TechnicalDicomMetadata,
  }));
  return {
    key: uid + ".2", label: "MR synthetic", modality: "MR",
    members, spatiallySorted: true, volumeReady: true, sliceSpacingMm: 2,
    warning: null, ...flags,
  };
}

test("Uniform indices include both endpoints and never repeat frames", () => {
  assert.deepEqual(uniformIndices(32, 4), [0, 10, 21, 31]);
  assert.deepEqual(uniformIndices(3, 4), [0, 1, 2]);
  assert.deepEqual(uniformIndices(1, 4), [0]);
  assert.deepEqual(uniformIndices(32, 1), [15]);
  assert.throws(() => uniformIndices(0, 4));
  assert.throws(() => uniformIndices(32, 5));
});
test("Frame manifest preserves exact SOP and projected physical geometry", () => {
  const selected = series();
  const report = planVisionFrameSamples([selected], selected.key);
  assert.equal(report.status, "ready-for-local-preview");
  assert.equal(report.coverage, "sampled-frames-only");
  assert.equal(report.transmissionPermitted, false);
  assert.equal(report.deidentificationVerified, false);
  assert.deepEqual(report.frames.map(f => f.ordinal), [1, 11, 22, 32]);
  assert.deepEqual(report.frames.map(f => f.slicePositionMm), [-31, -11, 11, 31]);
  assert.equal(report.frames[2].sopInstanceUid, "2.25.1043521000001.4.22");
  assert.equal(report.frames[2].fileId, "synthetic-21");
  assert.ok(report.warnings.some(x => x.includes("отдельные кадры")));
});
test("Active selection never falls through to unrelated healthy series", () => {
  const broken = series(32, {}, {key:"broken",volumeReady:false,warning:"bad"});
  const healthy = series(32, {}, {key:"healthy"});
  const result = planVisionFrameSamples([broken, healthy], broken.key);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.frames, []);
  assert.equal(result.seriesKey, "broken");
  assert.ok(result.blockers.some(x => x.includes("Геометрия")));
  assert.equal(planVisionFrameSamples([broken,healthy],null).seriesKey, healthy.key);
});
test("A wrong StudyUID, FrameOfReferenceUID, or multiframe source blocks all samples", () => {
  for (const wrong of [
    {studyUid:"2.25.999"}, {frameOfReferenceUid:"2.25.888"}, {numberOfFrames:2},
  ]) {
    const group = series();
    Object.assign(group.members[11].metadata, wrong);
    const result = planVisionFrameSamples([group], group.key);
    assert.equal(result.status,"blocked");
    assert.deepEqual(result.frames,[]);
  }
});
test("Invalid or duplicated SOPs are rejected before creating the manifest", () => {
  const group = series(5);
  group.members[2].metadata.sopInstanceUid = group.members[0].metadata.sopInstanceUid;
  assert.equal(planVisionFrameSamples([group],group.key).status,"blocked");
  group.members[2].metadata.sopInstanceUid = "contains patient name";
  assert.equal(planVisionFrameSamples([group],group.key).status,"blocked");
});
test("Unsupported modality and unresolved series do not create a plausible plan", () => {
  const other = series(8, {modality:"US"}, {modality:"US"});
  assert.equal(planVisionFrameSamples([other],other.key).status,"blocked");
  assert.equal(planVisionFrameSamples([]).status,"blocked");
  assert.equal(planVisionFrameSamples([series()], "unknown-key").status,"blocked");
  assert.throws(() => planVisionFrameSamples([series()],null,0));
});
