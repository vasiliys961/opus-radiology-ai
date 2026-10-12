import test from "node:test";
import assert from "node:assert/strict";
import { normalizeReviewerNote,restoreReviewerNote,reviewerNoteNeedsRecheck,saveReviewerNote,MAX_NOTE_VERSIONS } from "./evidence-reviewer-note.ts";
import { changeEvidenceReview,startEvidenceReview } from "./evidence-review-history.ts";
import { buildEvidenceReport } from "./evidence-report.ts";
import type { SegmentationEvidence } from "./segmentation-evidence.ts";

const geometry:SegmentationEvidence["mask"]["geometry"]={dimensions:[2,2,2],affineLps:[1,0,0,0,0,1,0,0,0,0,1,0]};
const base:SegmentationEvidence={schema:"opus-specialist-evidence/v1",clinicalStatus:"unverified_research_draft",
  producer:{kind:"specialist-model",executionMode:"local",model:{id:"synthetic",version:"1",weightsSha256:"a".repeat(64),modality:"CT",task:"synthetic-only"}},
  source:{requestId:"note-fixture",sourceIdentitySha256:"b".repeat(64),inputSha256:"c".repeat(64),modality:"CT",frameCount:2,scope:"selected-series-only",coverage:"not-confirmed",geometry},
  mask:{sha256:"d".repeat(64),geometry},limitations:["Synthetic only"],
  observations:[{observationId:"note-fixture:label:1",kind:"segmentation-measurement",labelId:1,labelName:"Synthetic label",voxels:4,volumeMl:0.004,
    boundsMaskIndex:{min:[0,0,0],max:[1,1,1]},anchorLpsMm:[0,0,0],review:"unreviewed"}]};
const at="2026-10-12T07:00:00.000Z",id=base.observations[0].observationId;
function noted(){return saveReviewerNote(startEvidenceReview(base),"Synthetic manual comment; no clinical finding.",at);}

test("note revisions are immutable; repeated save is a no-op and clearing retains prior text",()=>{
  const initial=startEvidenceReview(base),first=saveReviewerNote(initial,"Synthetic comment",at);
  assert.equal("reviewerNote" in initial,false);assert.equal(first.observations,initial.observations);assert.equal(first.mask,initial.mask);
  assert.equal(saveReviewerNote(first,"Synthetic comment",at),first);
  assert.equal(saveReviewerNote(initial,"",at),initial);
  const cleared=saveReviewerNote(first,"",at);
  assert.equal(cleared.reviewerNote?.versions.length,2);assert.equal(cleared.reviewerNote?.versions[0].text,"Synthetic comment");
  assert.equal(cleared.reviewerNote?.versions[1].text,"");assert.equal(first.reviewerNote?.versions.length,1);
  assert.equal(first.clinicalStatus,"unverified_research_draft");
});

test("changed review makes a note stale; explicit save of the same text binds a new version",()=>{
  const first=noted();assert.equal(reviewerNoteNeedsRecheck(first),false);
  const changed=changeEvidenceReview(first,id,"rejected",at) as typeof first;
  assert.equal(reviewerNoteNeedsRecheck(changed),true);
  const next=saveReviewerNote(changed,first.reviewerNote!.versions[0].text,at);
  assert.equal(next.reviewerNote?.versions.length,2);assert.equal(next.reviewerNote?.versions[1].reviewRevision,1);
  assert.equal(reviewerNoteNeedsRecheck(next),false);
  assert.equal(next.observations[0].review,"rejected"); // note does not override model review
});

test("note restores only onto matching model/source and exact canonical review prefix",()=>{
  const first=saveReviewerNote(changeEvidenceReview(startEvidenceReview(base),id,"requires_recheck",at),"Fixture note",at);
  const current=changeEvidenceReview(startEvidenceReview(base),id,"requires_recheck",at);
  assert.deepEqual(restoreReviewerNote(current,JSON.stringify(first.reviewerNote)).reviewerNote,first.reviewerNote);
  for(const key of Object.keys(first.reviewerNote!.binding)){
    const n=structuredClone(first.reviewerNote!);Object.assign(n.binding,{[key]:"different"});
    assert.throws(()=>restoreReviewerNote(current,JSON.stringify(n)),/другому источнику/);
  }
  assert.throws(()=>restoreReviewerNote(startEvidenceReview(base),JSON.stringify(first.reviewerNote)),/соответствующая история/);
  const fork=changeEvidenceReview(startEvidenceReview(base),id,"rejected",at);
  assert.throws(()=>restoreReviewerNote(fork,JSON.stringify(first.reviewerNote)),/другой последовательности/);
  const forged=structuredClone(first.reviewerNote!);forged.versions[0].reviewSha256="f".repeat(64);
  assert.throws(()=>restoreReviewerNote(current,JSON.stringify(forged)),/другой последовательности/);
});

test("older/forked note import preserves local versions; extending import is allowed",()=>{
  const first=noted(),next=saveReviewerNote(first,"Second synthetic comment",at);
  assert.equal(restoreReviewerNote(first,JSON.stringify(next.reviewerNote)).reviewerNote?.versions.length,2);
  assert.throws(()=>restoreReviewerNote(next,JSON.stringify(first.reviewerNote)),/не продолжает/);
  const fork=saveReviewerNote(startEvidenceReview(base),"Different synthetic comment",at);
  assert.throws(()=>restoreReviewerNote(first,JSON.stringify(fork.reviewerNote)),/не продолжает/);
  assert.equal(first.reviewerNote?.versions[0].text,"Synthetic manual comment; no clinical finding.");
});

test("bounded parser rejects signed authors/status, invalid revisions/time/text and oversized UTF-8",()=>{
  for(const mutation of [{revision:0},{reviewRevision:-1},{reviewRevision:0.5},{text:"x".repeat(4001)},{at:"yesterday"},{actor:"authenticated-doctor"}]){
    const n=structuredClone(noted().reviewerNote!);Object.assign(n.versions[0],mutation);
    assert.throws(()=>normalizeReviewerNote(n,startEvidenceReview(base)));
  }
  assert.throws(()=>normalizeReviewerNote({...noted().reviewerNote!,clinicalStatus:"signed"},startEvidenceReview(base)));
  assert.throws(()=>saveReviewerNote(startEvidenceReview(base),"x".repeat(4001),at));
  assert.throws(()=>restoreReviewerNote(startEvidenceReview(base),"{"),/JSON/);
  assert.throws(()=>restoreReviewerNote(startEvidenceReview(base),JSON.stringify({...noted().reviewerNote,extra:"я".repeat(260_000)})),/512 КБ/);
  let r=noted();for(let i=1;i<MAX_NOTE_VERSIONS;i++)r=saveReviewerNote(r,`Synthetic version ${i}`,at);
  assert.equal(r.reviewerNote?.versions.length,32);assert.throws(()=>saveReviewerNote(r,"Another version",at),/лимит 32/);
  assert.equal(r.reviewerNote?.versions.length,32);
});

test("report escapes reviewer text, separates it from models and visibly flags stale/cleared notes",t=>{
  t.mock.method(globalThis,"fetch",async()=>{throw Error("Notes stay local");});
  const r=saveReviewerNote(startEvidenceReview(base),'<script>alert(1)</script> Synthetic manual text.',at);
  const html=buildEvidenceReport(r,{generatedAt:at});
  assert.match(html,/Заметка проверяющего · черновик/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script/);
  assert.match(html,/автор не удостоверен/);assert.match(html,/Текст связан с текущей историей/);
  const stale=changeEvidenceReview(r,id,"rejected",at) as typeof r;
  assert.match(buildEvidenceReport(stale,{generatedAt:at}),/Заметку нужно перепроверить/);
  const cleared=saveReviewerNote(r,"",at);
  assert.match(buildEvidenceReport(cleared,{generatedAt:at}),/Текущая заметка очищена/);
});

test("allowlisting ignores unknown opaque buffers/secrets without reading getters or changing measurements",()=>{
  const r=noted(),n=structuredClone(r.reviewerNote!);
  for(const obj of [n,n.binding,n.versions[0]])Object.defineProperty(obj,"opaqueImage",{enumerable:true,get(){throw Error("Opaque field must not be read");}});
  const normalized=normalizeReviewerNote(n,r);
  assert.doesNotMatch(JSON.stringify(normalized),/opaqueImage/);
  const raw=JSON.stringify({...normalized,token:"secret-sentinel",patientName:"PHI-sentinel",versions:normalized.versions.map(v=>({...v,extra:"secret-sentinel"}))});
  const restored=restoreReviewerNote(startEvidenceReview(base),raw);
  assert.doesNotMatch(JSON.stringify(restored),/secret-sentinel|PHI-sentinel/);
  assert.equal(restored.observations[0].volumeMl,0.004);assert.equal(restored.source,base.source);
});
