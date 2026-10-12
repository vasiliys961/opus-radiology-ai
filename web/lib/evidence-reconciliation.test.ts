import test from "node:test";
import assert from "node:assert/strict";
import { checkLlmAnchor, createLlmMeasurementTemplate, parseLlmMeasurements, reconcileEvidence, type LlmMeasurements } from "./evidence-reconciliation.ts";
import type { SegmentationEvidence } from "./segmentation-evidence.ts";
import { invertAffine, sampleMaskLabel, transformPoint, type LabelMask } from "./segmentation-mask.ts";

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

function anchored(point: [number,number,number] = [0,0,0]) {
  const l = claims();
  l.claims[0].anchor = {coordinateSystem: "LPS-mm", pointLpsMm: point, maskSha256: evidence.mask.sha256};
  return l;
}
function maskFixture(): LabelMask {
  return {...geometry, inverseLps: invertAffine(geometry.affineLps), data: new Uint16Array([1,0,2,1,1,0,2,1]),
    labels: [], voxelVolumeMm3: 1};
}

test("optional LPS anchors parse strictly, preserve old imports and exclude unknown properties", () => {
  const legacy = claims(); delete legacy.claims[0].anchor;
  assert.equal(parseLlmMeasurements(JSON.stringify(legacy)).claims[0].anchor, undefined);
  assert.equal(parseLlmMeasurements(JSON.stringify(createLlmMeasurementTemplate(evidence))).claims[0].anchor, null);
  const l = anchored();
  const parsed = parseLlmMeasurements(JSON.stringify({...l, claims: [{...l.claims[0], anchor: {...l.claims[0].anchor, token: "secret-sentinel"}}]}));
  assert.deepEqual(parsed.claims[0].anchor, l.claims[0].anchor);
  assert.doesNotMatch(JSON.stringify(parsed), /secret-sentinel/);
  for (const mutation of [{coordinateSystem: "RAS-mm"}, {pointLpsMm: [0,0]}, {pointLpsMm: [0,"0",0]},
    {pointLpsMm: [0,0,null]}, {maskSha256: "invalid"}]) {
    const bad = anchored(); Object.assign(bad.claims[0].anchor!, mutation);
    assert.throws(() => parseLlmMeasurements(JSON.stringify(bad)));
  }
  assert.throws(() => parseLlmMeasurements(JSON.stringify(l).replace('"pointLpsMm":[0,0,0]', '"pointLpsMm":[0,1e999,0]')));
});

test("spatial point QC reports target/background/different labels without clinical agreement", () => {
  const mask = maskFixture(), sampler = (p: [number,number,number]) => sampleMaskLabel(mask, p);
  for (const [point, relation, label] of [ [[0,0,0],"target_label",1], [[1,0,0],"background",0], [[0,1,0],"different_label",2] ] as const) {
    const l = anchored([...point]); const c = reconcileEvidence(evidence, l, sampler).comparisons[0];
    assert.equal(c.spatial?.status, "in_volume"); assert.equal(c.spatial?.relation, relation);
    assert.equal(c.spatial?.sampledLabelId, label); assert.equal(c.spatial?.review, "needs_review");
    assert.deepEqual(c.spatial?.sourceIndex, point);
  }
  const l = anchored(); l.claims[0].metric = "other"; l.claims[0].scope = "unknown"; l.claims[0].valueMl = null;
  const c = reconcileEvidence(evidence, l, sampler).comparisons[0];
  assert.equal(c.status, "not_comparable"); assert.equal(c.spatial?.relation, "target_label");
  assert.equal(c.deltaMl, null); // point membership never converts unsupported pathology into agreement
});

test("wrong source/weights/mask/target or rejected label blocks point navigation before sampling", () => {
  const mutations = [
    (l: LlmMeasurements) => {l.source.inputSha256 = "e".repeat(64);},
    (l: LlmMeasurements) => {l.source.requestId = "other";},
    (l: LlmMeasurements) => {l.source.modality = "MR";},
    (l: LlmMeasurements) => {l.source.frameCount++;},
    (l: LlmMeasurements) => {l.source.sourceIdentitySha256 = "e".repeat(64);},
    (l: LlmMeasurements) => {l.claims[0].anchor!.maskSha256 = "e".repeat(64);},
    (l: LlmMeasurements) => {l.claims[0].modelWeightsSha256 = "e".repeat(64);},
    (l: LlmMeasurements) => {l.claims[0].observationId = "missing";},
  ];
  const sampler = () => {throw Error("Must not sample unbound claims");};
  for (const mutate of mutations) {
    const l = anchored(); mutate(l);
    const c = checkLlmAnchor(evidence, l, l.claims[0], sampler);
    assert.equal(c?.status, "not_bound"); assert.equal(c?.pointLpsMm, null); assert.ok(c!.reasons.length > 0);
  }
  const l = anchored(), rejected = {...evidence, observations: evidence.observations.map(o => ({...o, review: "rejected" as const}))};
  assert.equal(checkLlmAnchor(rejected, l, l.claims[0], sampler)?.status, "not_bound");
});

test("out-of-volume and unavailable active mask never become background or navigable coordinates", () => {
  const l = anchored([1.5001,0,0]), sampler = () => {throw Error("Outside point must not be sampled");};
  const outside = checkLlmAnchor(evidence, l, l.claims[0], sampler);
  assert.equal(outside?.status, "outside_volume"); assert.equal(outside?.pointLpsMm, null);
  const inside = anchored();
  for (const read of [undefined, () => null, () => {throw Error("closed");}, () => NaN, () => -1]) {
    const c = checkLlmAnchor(evidence, inside, inside.claims[0], read);
    assert.equal(c?.sampledLabelId, null); assert.equal(c?.relation, "not_checked");
    assert.ok(c!.reasons.length > 0);
  }
  assert.equal(checkLlmAnchor(evidence, claims(), claims().claims[0]), null);
});

test("LPS affine and a permuted mask grid map the same physical point without resampling", () => {
  const affine = [0,-2,0,10,1,0,0,20,0,0,-3,30] as typeof geometry.affineLps;
  const maskAffine = [0,0,-2,10,1,0,0,20,0,-3,0,30] as typeof geometry.affineLps;
  const e = {...evidence, source: {...evidence.source, geometry: {...geometry, affineLps: affine}},
    mask: {...evidence.mask, geometry: {...geometry, affineLps: maskAffine}}};
  const mask = {...maskFixture(), affineLps: maskAffine, inverseLps: invertAffine(maskAffine)};
  mask.data[3] = 2;
  const point = transformPoint(affine, [1,0,1]), l = anchored(point);
  assert.deepEqual(point, [10,21,27]);
  const c = checkLlmAnchor(e, l, l.claims[0], p => sampleMaskLabel(mask, p));
  assert.deepEqual(c?.sourceIndex, [1,0,1]); assert.equal(c?.sampledLabelId, 2);
  assert.equal(c?.relation, "different_label");
});

test("discrete mask sampling uses nearest neighbour and inclusive half-voxel boundaries", () => {
  const mask = maskFixture();
  assert.equal(sampleMaskLabel(mask, [-0.5,0,0]), 1);
  assert.equal(sampleMaskLabel(mask, [1.5,0,0]), 0);
  assert.equal(sampleMaskLabel(mask, [0.49,0,0]), 1);
  assert.equal(sampleMaskLabel(mask, [0.51,0,0]), 0);
  for (const p of [[-0.5001,0,0], [1.5001,0,0], [NaN,0,0]] as [number,number,number][])
    assert.equal(sampleMaskLabel(mask, p), null);
  assert.equal(sampleMaskLabel({...mask, data: new Uint16Array(1)}, [0,0,0]), null);
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
