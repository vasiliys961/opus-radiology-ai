import test from "node:test";
import assert from "node:assert/strict";
import { AI_CATALOG, changeProvider, modelsForRole } from "./v17-models.ts";
import { PILOT_CASES, PILOT_NOTES } from "./v17-pilot.ts";
import { deriveStudyReadiness } from "./study-intelligence.ts";
import { validateEvidenceJson } from "./evidence-json.ts";
import type { DicomSeries } from "./dicom-series.ts";

test("Model registry distinguishes cloud LLMs from local inference", () => {
  assert.ok(modelsForRole("vision").some(m => m.id.includes("gemini")));
  assert.ok(modelsForRole("clinical").some(m => m.id.includes("claude")));
  assert.ok(AI_CATALOG.find(m => m.id === "totalsegmentator")?.engine === "inference-worker");
  assert.equal(AI_CATALOG.find(m => m.id === "nv-segment-ctmr")?.status, "research");
});
test("Physician provider choice is explicit", () => {
  assert.equal(changeProvider("polza", "openrouter"), "openrouter");
  assert.equal(changeProvider("openrouter", "polza"), "polza");
  assert.throws(() => changeProvider("polza", "unknown" as never));
});
test("Pilot records are stable reference values and do not claim pathology accuracy", () => {
  assert.equal(PILOT_CASES.length, 6);
  assert.equal(PILOT_NOTES.successfulRuns, 12);
  assert.equal(PILOT_NOTES.pathologyValidated, false);
  assert.equal(PILOT_CASES.every(x => x.geometryPassed), true);
  assert.ok(Math.abs(PILOT_CASES.find(x => x.id === "mr-head-s0537")!.totalDice - .9751938158657497) < 1e-6);
});
test("Geometry readiness is metadata only; no assessment without study", () => {
  const empty = deriveStudyReadiness([]);
  assert.equal(empty.status, "no-study");
  assert.equal(empty.analysedSlices, 0);
  const series: DicomSeries[] = [{ key: "s", label: "s", modality: "CT", members: [],
    spatiallySorted: true, volumeReady: true, sliceSpacingMm: 1, warning: null }];
  const report = deriveStudyReadiness(series);
  assert.equal(report.status, "geometry-ready");
  assert.equal(report.analysedSlices, 0);
  assert.ok(report.warnings.some(x => x.includes("не подтверждаются")));
});
test("Evidence schema rejects unlinked and unassessed findings", () => {
  const original = {
    schema: "opus-evidence/v1", modality: "CT", coverage: "assessed",
    seriesReviewed: ["series-a"], warnings: [],
    findings: [{
      findingId: "x1", sign: "suspected focal change", anatomy: "lung",
      status: "candidate",
      source: { seriesUid: "series-a", sopInstanceUid: null, frameIndex: 3, slicePositionMm: 24 },
      measurements: { diameterMm: null, volumeMl: null },
      model: { id: "google/gemini-3.8-flash", provider: "openrouter", version: null },
      limitations: ["Unconfirmed observation"],
    }],
  };
  assert.equal(validateEvidenceJson(original), true);
  assert.equal(validateEvidenceJson({...original, coverage:"not_assessed"}), false);
  assert.equal(validateEvidenceJson({...original, findings:[{...original.findings[0], source:{...original.findings[0].source, seriesUid:"different"}}]}), false);
  assert.equal(validateEvidenceJson({...original, findings:[original.findings[0],original.findings[0]]}), false);
});
