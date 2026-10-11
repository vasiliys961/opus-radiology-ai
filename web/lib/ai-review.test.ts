import test from "node:test";
import assert from "node:assert/strict";
import { parseReviewableOrchestraResult, bindFindingsToLocalDicom } from "./ai-review.ts";
import type { DicomSeries, TechnicalDicomMetadata } from "./dicom-series.ts";

const SOURCE_UID = "2.25.1010";
const SERIES_UID = "2.25.1000";
const sample = () => ({
  schema: "opus-orchestra/v1",
  modality: "CT", provider: "polza",
  visionModel: "google/gemini", clinicalModel: "anthropic/claude",
  clinicalStatus: "unverified_research_draft",
  sourceImages: [{
    imageId: "frame-1", mimeType: "image/png", viewLabel: "synthetic",
    seriesUid: SERIES_UID, sopInstanceUid: SOURCE_UID,
    frameIndex: 0, slicePositionMm: 12,
  }],
  evidence: {
    schema: "opus-evidence/v1", modality: "CT",
    coverage: "partially_assessed", seriesReviewed: [SERIES_UID], warnings: [],
    findings: [{
      findingId: "anatomy:1", sign: "Visible circular shape", anatomy: "phantom",
      status: "candidate",
      source: { seriesUid: SERIES_UID, sopInstanceUid: SOURCE_UID,
        frameIndex: 0, slicePositionMm: 12 },
      measurements: { diameterMm: null, volumeMl: null },
      model: { id: "google/gemini", provider: "polza", version: null },
      limitations: ["Schematic image only"],
    }],
  },
  clinicalDraft: { summary: "Synthetic specimen only.", limitations: [] },
});
const metadata = (sop = SOURCE_UID): TechnicalDicomMetadata => ({
  sopInstanceUid: sop, studyUid: "study-1", seriesUid: SERIES_UID,
  frameOfReferenceUid: "frame-of-reference-1", modality: "CT",
  instanceNumber: 1, numberOfFrames: 1, rows: 96, columns: 96,
  imagePositionPatient: [0, 0, 12],
  imageOrientationPatient: [1, 0, 0, 0, 1, 0],
  pixelSpacing: [1, 1], transferSyntax: "1.2.840.10008.1.2.1",
});
const group = (sop = SOURCE_UID): DicomSeries => ({
  key: "group1", label: "CT", modality: "CT", spatiallySorted: true,
  volumeReady: true, warning: null, sliceSpacingMm: 3,
  members: [{ id: "local-file-3", name: "slice-3.dcm", metadata: metadata(sop) }],
});

test("Research JSON parses and local finding connects to unique DICOM SOP", () => {
  const parsed = parseReviewableOrchestraResult(JSON.stringify(sample()));
  const links = bindFindingsToLocalDicom(parsed, [group()]);
  assert.equal(links.length, 1);
  assert.equal(links[0].memberId, "local-file-3");
  assert.equal(links[0].sourceLabel, "slice-3.dcm");
  assert.equal(links[0].findingId, "anatomy:1");
});
test("Failed model-to-source mapping refuses invented frame position", () => {
  const changed = sample();
  changed.evidence.findings[0].source.slicePositionMm = 999;
  assert.throws(() => parseReviewableOrchestraResult(JSON.stringify(changed)), /связана/);
});
test("Review refuses different DICOM study, duplicate SOP and multiframe ambiguity", () => {
  const parsed = parseReviewableOrchestraResult(JSON.stringify(sample()));
  assert.throws(() => bindFindingsToLocalDicom(parsed, []), /Сначала/);
  assert.throws(() => bindFindingsToLocalDicom(parsed, [group("OTHER")]), /SOPInstanceUID/);
  assert.throws(() => bindFindingsToLocalDicom(parsed, [group(), group()]), /SeriesInstanceUID/);
  const multi = group();
  multi.members[0].metadata.numberOfFrames = 3;
  assert.throws(() => bindFindingsToLocalDicom(parsed, [multi]), /много-кадрового/);
});
test("Untrusted imports reject embedded image payloads, unsupported status, wrong modality", () => {
  const x = sample();
  assert.throws(() => parseReviewableOrchestraResult(JSON.stringify({
    ...x, sourceImages: [{ ...x.sourceImages[0], base64: "hidden" }],
  })), /паспорта/);
  assert.throws(() => parseReviewableOrchestraResult(JSON.stringify({
    ...x, clinicalStatus: "clinically_validated",
  })), /контракт/);
  assert.throws(() => parseReviewableOrchestraResult(JSON.stringify({
    ...x, modality: "MR",
  })), /контракт/);
  assert.throws(() => parseReviewableOrchestraResult(" ".repeat(600_000)), /512/);
});
