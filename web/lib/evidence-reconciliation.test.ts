import test from "node:test";
import assert from "node:assert/strict";
import { createLlmMeasurementTemplate, parseLlmMeasurements, reconcileEvidence, type LlmMeasurements } from "./evidence-reconciliation.ts";
import type { SegmentationEvidence } from "./segmentation-evidence.ts";

// Metadata fixture only: no image volume, model or provider execution.
const geometry = {dimensions: [2, 2, 2] as [number, number, number], affineLps: [1,0,0,0,0,1,0,0,0,0,1,0] as SegmentationEvidence["mask"]["geometry"]["affineLps"]};
const evidence: SegmentationEvidence = {
  schema: "opus-specialist-evidence/v1", clinicalStatus: "unverified_research_draft",
  producer: {kind: "specialist-model", executionMode: "local", model: {id: "synthetic", version: "1", weightsSha256: "a".repeat(64), modality: "CT", task: "synthetic-only"}},
  source: {requestId: "fixture-request", sourceIdentitySha256: "b".repeat(64), inputSha256: "c".repeat(64),
    frameCount: 2, modality: "CT", scope: "selected-series-only", coverage: "not-confirmed", geometry},
  mask: {sha256: "d".repeat(64), geometry}, limitations: ["Synthetic only"],
  observations: [{observationId: "fixture-request:label:1", kind: "segmentation-measurement", labelId: 1, labelName: "Synthetic label",
    voxels: 4, volumeMl: 0.004, boundsMaskIndex: {min: [0,0,0], max: [1,1,1]}, anchorLpsMm: [0,0,0], review: "unreviewed"}],
};
function claims(valueMl = 0.006): LlmMeasurements {
  const l = createLlmMeasurementTemplate(evidence);
  l.producer = {kind: "llm", provider: "synthetic-fixture", model: "no-provider-called"};
  l.claims[0] = {...l.claims[0], scope: "loaded-slices", valueMl, statement: "Synthetic measurement claim"};
  return l;
}

test("bound numeric differences preserve both values and always require review", t => {
  t.mock.method(globalThis, "fetch", async () => {throw Error("No provider calls allowed");});
  const before = JSON.stringify(evidence), llm = parseLlmMeasurements(JSON.stringify(claims()));
  const result = reconcileEvidence(evidence, llm), c = result.comparisons[0];
  assert.equal(c.status, "numeric_difference"); assert.equal(c.deltaMl, 0.002);
  assert.equal(c.specialistVolumeMl, 0.004); assert.equal(c.llmVolumeMl, 0.006);
  assert.equal(c.review, "needs_review"); assert.deepEqual(c.reasons, []);
  assert.equal(result.provenance, "imported-unverified"); assert.equal(result.clinicalStatus, "unverified_research_draft");
  assert.equal(JSON.stringify(evidence), before);
  assert.equal(reconcileEvidence(evidence, claims(0.004)).comparisons[0].status, "numeric_match");
  assert.equal(reconcileEvidence(evidence, claims(0.004)).comparisons[0].review, "needs_review");
  assert.equal(reconcileEvidence(evidence, claims(0)).comparisons[0].deltaMl, -0.004);
  assert.equal(reconcileEvidence(evidence, claims(0.004 + 1e-10)).comparisons[0].status, "numeric_difference");
});

test("each source binding field independently prevents numeric comparison", () => {
  for (const [key, value] of Object.entries({requestId: "other", sourceIdentitySha256: "e".repeat(64), inputSha256: "f".repeat(64), frameCount: 3, modality: "MR"})) {
    const l = claims(); Object.assign(l.source, {[key]: value});
    const c = reconcileEvidence(evidence, l).comparisons[0];
    assert.equal(c.status, "not_comparable", key); assert.equal(c.deltaMl, null);
    assert.deepEqual(c.reasons, ["source_binding_mismatch"]);
    assert.equal(c.llmVolumeMl, 0.006); // claimed value remains visible, not silently discarded
  }
});

test("scope, task, target weights, missing/absent values and rejection give actionable abstention", () => {
  const mutations = [
    [{scope: "full-organ"}, "scope_mismatch"], [{scope: "unknown"}, "scope_mismatch"],
    [{metric: "other", statement: "Possible pathology; not a segmentation metric"}, "unsupported_metric"],
    [{modelWeightsSha256: "e".repeat(64)}, "target_mismatch"],
    [{observationId: "absent-label"}, "label_unavailable"], [{valueMl: null}, "missing_value"],
  ] as const;
  for (const [mutation, reason] of mutations) {
    const l = claims(); Object.assign(l.claims[0], mutation);
    const c = reconcileEvidence(evidence, parseLlmMeasurements(JSON.stringify(l))).comparisons[0];
    assert.deepEqual(c.reasons, [reason]); assert.equal(c.deltaMl, null); assert.equal(c.status, "not_comparable");
  }
  const rejected = {...evidence, observations: evidence.observations.map(o => ({...o, review: "rejected" as const}))};
  assert.deepEqual(reconcileEvidence(rejected, claims()).comparisons[0].reasons, ["specialist_rejected"]);
  assert.equal(reconcileEvidence({...evidence, observations: []}, claims()).comparisons[0].specialistVolumeMl, null);
});

test("template does not copy predictions or invent assessed coverage/provider", () => {
  const l = parseLlmMeasurements(JSON.stringify(createLlmMeasurementTemplate(evidence)));
  assert.equal(l.claims[0].valueMl, null); assert.equal(l.claims[0].scope, "unknown");
  assert.equal(l.producer.model, "not-recorded");
  assert.deepEqual(reconcileEvidence(evidence, l).comparisons[0].reasons, ["scope_mismatch", "missing_value"]);
  assert.equal("geometry" in l.source, false); assert.equal("mask" in l, false);
  assert.deepEqual(createLlmMeasurementTemplate({...evidence, observations: []}).claims, []);
});

test("strict bounded parser rejects malformed/legacy/coerced fields and duplicate ids", () => {
  assert.throws(() => parseLlmMeasurements("{"), /JSON/);
  for (const schema of ["opus-orchestra/v1", "opus-evidence/v1"])
    assert.throws(() => parseLlmMeasurements(JSON.stringify({schema})), /не содержит SHA/);
  const invalid = [
    (l: LlmMeasurements) => {l.claims.push({...l.claims[0]});},
    (l: LlmMeasurements) => {l.source.inputSha256 = "bad";},
    (l: LlmMeasurements) => {l.source.frameCount = 1.5;},
    (l: LlmMeasurements) => {l.source.modality = ["CT"] as never;},
    (l: LlmMeasurements) => {l.claims[0].metric = ["label-volume-ml"] as never;},
    (l: LlmMeasurements) => {l.claims[0].scope = ["loaded-slices"] as never;},
    (l: LlmMeasurements) => {l.claims[0].valueMl = -1;},
    (l: LlmMeasurements) => {l.claims[0].valueMl = "0.006" as never;},
    (l: LlmMeasurements) => {l.claims = [];},
    (l: LlmMeasurements) => {l.claims = Array.from({length: 101}, (_,i) => ({...l.claims[0], claimId: String(i)}));},
    (l: LlmMeasurements) => {l.clinicalStatus = "verified_by_human" as never;},
  ];
  for (const mutate of invalid) {const l = claims(); mutate(l); assert.throws(() => parseLlmMeasurements(JSON.stringify(l)));}
  // UTF-8 byte cap, not just character count. Unknown fields cannot bypass it.
  assert.throws(() => parseLlmMeasurements(JSON.stringify({...claims(), extra: "я".repeat(260_000)})), /слишком большой/);
  assert.throws(() => parseLlmMeasurements(JSON.stringify(claims()).replace('"valueMl":0.006', '"valueMl":1e999')));
});

test("allowlisted import/export drops unknown secrets/PHI/buffers at every level", () => {
  const l = claims();
  const imported = parseLlmMeasurements(JSON.stringify({...l, patientName: "PHI-sentinel", token: "secret-sentinel",
    source: {...l.source, sopInstanceUid: "PHI-sentinel"}, producer: {...l.producer, apiKey: "secret-sentinel"},
    claims: l.claims.map(c => ({...c, base64: "secret-sentinel", extra: {patient: "PHI-sentinel"}}))}));
  assert.doesNotMatch(JSON.stringify(reconcileEvidence(evidence, imported)), /PHI-sentinel|secret-sentinel|base64|sopInstanceUid/);
});
