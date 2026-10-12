import test from "node:test";
import assert from "node:assert/strict";
import { changeEvidenceReview, MAX_REVIEW_EVENTS, parseEvidenceReviewHistory, restoreEvidenceReview, startEvidenceReview } from "./evidence-review-history.ts";
import type { SegmentationEvidence } from "./segmentation-evidence.ts";
import { createLlmMeasurementTemplate, reconcileEvidence } from "./evidence-reconciliation.ts";

const geometry: SegmentationEvidence["mask"]["geometry"] = {dimensions: [2,2,2], affineLps: [1,0,0,0,0,1,0,0,0,0,1,0]};
const base: SegmentationEvidence = {schema: "opus-specialist-evidence/v1", clinicalStatus: "unverified_research_draft",
  source: {requestId: "synthetic-history", sourceIdentitySha256: "b".repeat(64), inputSha256: "c".repeat(64),
    modality: "CT", frameCount: 2, scope: "selected-series-only", coverage: "not-confirmed", geometry},
  producer: {kind: "specialist-model", executionMode: "local", model: {id: "synthetic-only", version: "1", weightsSha256: "a".repeat(64), modality: "CT", task: "synthetic-only"}},
  mask: {sha256: "d".repeat(64), geometry}, limitations: ["No real inference"],
  observations: [1,2].map(labelId => ({observationId: `synthetic-history:label:${labelId}`, kind: "segmentation-measurement", labelId,
    labelName: `Synthetic ${labelId}`, voxels: 4, volumeMl: 0.004, boundsMaskIndex: {min:[0,0,0],max:[1,1,1]}, anchorLpsMm: [0,0,0], review: "unreviewed"}))};
const id = base.observations[0].observationId, other = base.observations[1].observationId;
const at = "2026-10-12T06:00:00.000Z";
function reviewed() {return changeEvidenceReview(startEvidenceReview(base), id, "requires_recheck", at);}

test("review appends immutable transitions, repeated decisions do not inflate history and reset retains events", () => {
  const initial = startEvidenceReview(base), first = changeEvidenceReview(initial, id, "requires_recheck", at);
  assert.equal(initial.reviewHistory.events.length, 0); assert.equal(initial.observations[0].review, "unreviewed");
  assert.equal(first.reviewHistory.events[0].revision, 1); assert.equal(first.reviewHistory.events[0].from, "unreviewed");
  assert.equal(changeEvidenceReview(first, id, "requires_recheck", at), first);
  const rejected = changeEvidenceReview(first, id, "rejected", at), reset = changeEvidenceReview(rejected, id, "unreviewed", at);
  assert.deepEqual(reset.reviewHistory.events.map(e => [e.revision,e.from,e.to]),
    [[1,"unreviewed","requires_recheck"],[2,"requires_recheck","rejected"],[3,"rejected","unreviewed"]]);
  assert.equal(reset.observations[1].review, "unreviewed"); assert.equal(first.observations[0].review, "requires_recheck");
  assert.equal(reset.clinicalStatus, "unverified_research_draft");
  assert.equal(reset.mask, initial.mask); assert.equal(reset.source, initial.source); // metadata only, no volume copies
});

test("history restores onto fresh current Evidence and accepts only identical or extending journals", () => {
  const first = reviewed(), next = changeEvidenceReview(first, other, "rejected", at);
  const restored = restoreEvidenceReview(startEvidenceReview(base), JSON.stringify(next.reviewHistory));
  assert.deepEqual(restored.observations, next.observations); assert.deepEqual(restored.reviewHistory, next.reviewHistory);
  assert.deepEqual(restoreEvidenceReview(first, JSON.stringify(next.reviewHistory)).reviewHistory, next.reviewHistory);
  assert.deepEqual(restoreEvidenceReview(next, JSON.stringify(next.reviewHistory)).reviewHistory, next.reviewHistory);
  assert.throws(() => restoreEvidenceReview(next, JSON.stringify(first.reviewHistory)), /не продолжает/);
  const fork = changeEvidenceReview(startEvidenceReview(base), id, "rejected", at);
  assert.throws(() => restoreEvidenceReview(first, JSON.stringify(fork.reviewHistory)), /не продолжает/);
  assert.equal(next.observations[1].review, "rejected");
});

test("every binding field blocks restoration onto unrelated source/mask/model", () => {
  for (const key of Object.keys(reviewed().reviewHistory.binding)) {
    const h = structuredClone(reviewed().reviewHistory);
    Object.assign(h.binding, {[key]: "different"});
    assert.throws(() => restoreEvidenceReview(startEvidenceReview(base), JSON.stringify(h)), /другому пакету/);
  }
  const changed = {...base, observations: base.observations.slice(1)};
  assert.throws(() => parseEvidenceReviewHistory(JSON.stringify(reviewed().reviewHistory), changed), /последовательность/);
});

test("strict replay refuses skipped revisions, forged from-state, no-op events, bad timestamps and signed status", () => {
  const invalid = [
    {revision: 0}, {revision: 2}, {observationId: "missing"}, {from: "rejected"}, {to: "unreviewed"},
    {to: "verified_by_human"}, {actor: "authenticated-physician"}, {at: "yesterday"},
    {at: "2026-02-30T06:00:00.000Z"}, {at: "2026-10-12T06:00:00+00:00"},
  ];
  for (const mutation of invalid) {
    const h = structuredClone(reviewed().reviewHistory); Object.assign(h.events[0], mutation);
    assert.throws(() => parseEvidenceReviewHistory(JSON.stringify(h), base));
  }
  const repeated = reviewed().reviewHistory;
  assert.throws(() => parseEvidenceReviewHistory(JSON.stringify({...repeated, events:[...repeated.events,...repeated.events]}), base));
  assert.throws(() => changeEvidenceReview(reviewed(), id, "verified_by_human" as never, at));
  assert.throws(() => changeEvidenceReview(reviewed(), "missing", "rejected", at));
  assert.throws(() => changeEvidenceReview(reviewed(), id, "rejected", "yesterday"));
  assert.throws(() => startEvidenceReview(reviewed()));
});

test("untrusted clocks never determine ordering; exported history preserves declarations", () => {
  const first = reviewed(), second = changeEvidenceReview(first, id, "rejected", "2020-01-01T00:00:00.000Z");
  const h = parseEvidenceReviewHistory(JSON.stringify(second.reviewHistory), base);
  assert.equal(h.events[1].revision, 2); assert.equal(h.events[1].at, "2020-01-01T00:00:00.000Z");
  assert.equal(h.provenance, "local-unverified");
});

test("bounded journal refuses growth without dropping prior decisions; UTF-8 file limit is real", () => {
  let r = startEvidenceReview(base);
  for (let i=0;i<MAX_REVIEW_EVENTS;i++) r = changeEvidenceReview(r,id,i%2 ? "unreviewed" : "rejected",at);
  assert.equal(r.reviewHistory.events.length, MAX_REVIEW_EVENTS);
  assert.throws(() => changeEvidenceReview(r,id,"rejected",at), /лимит 512/);
  assert.equal(r.observations[0].review, "unreviewed");
  assert.equal(parseEvidenceReviewHistory(JSON.stringify(r.reviewHistory),base).events.length,MAX_REVIEW_EVENTS);
  assert.throws(() => parseEvidenceReviewHistory(JSON.stringify({...r.reviewHistory,events:[...r.reviewHistory.events,r.reviewHistory.events[0]]}),base));
  assert.throws(() => parseEvidenceReviewHistory(JSON.stringify({...reviewed().reviewHistory,extra:"я".repeat(130_000)}),base), /256 КБ/);
  assert.throws(() => parseEvidenceReviewHistory("{",base), /JSON/);
});

test("canonical restore drops unknown PHI/secrets and never calls providers or replaces measurements", t => {
  t.mock.method(globalThis,"fetch",async () => {throw Error("Review stays local");});
  const h = reviewed().reviewHistory;
  const raw = JSON.stringify({...h,patientName:"PHI-sentinel",token:"secret-sentinel",observations:[{volumeMl:999}],
    binding:{...h.binding,sopInstanceUid:"PHI-sentinel"},events:h.events.map(e=>({...e,comment:"PHI-sentinel",apiKey:"secret-sentinel"}))});
  const restored = restoreEvidenceReview(startEvidenceReview(base),raw);
  assert.doesNotMatch(JSON.stringify(restored),/PHI-sentinel|secret-sentinel|sopInstanceUid/);
  assert.equal(restored.observations[0].volumeMl,0.004); assert.equal(restored.source,base.source);
  const llm = createLlmMeasurementTemplate(base); llm.claims[0].scope="loaded-slices";llm.claims[0].valueMl=0.004;
  const rejected=changeEvidenceReview(restored,id,"rejected",at), compared=reconcileEvidence(rejected,llm);
  assert.equal(compared.comparisons[0].status,"not_comparable");
  assert.deepEqual(compared.comparisons[0].reasons,["specialist_rejected"]);
  assert.equal((compared.specialist as typeof rejected).reviewHistory.events.length,2);
});
