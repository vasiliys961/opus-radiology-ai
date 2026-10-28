import {strict as assert} from "node:assert";
import {createNativePhysicianDraft} from "./native-physician-draft.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";
import type {EvidenceJson} from "./evidence-json.ts";
import type {BoundWmh} from "./wmh-source-review.ts";

const make=(modality:"CT"|"MR"):DicomSeries=>({
 key:"a",label:"study",modality,spatiallySorted:true,volumeReady:true,sliceSpacingMm:1,warning:null,
 members:[0,1].map(i=>({id:"f-"+i,name:"slice-"+i,
   metadata:{modality,studyUid:"1.2",seriesUid:"1.2.3",sopInstanceUid:"1.2.3."+i} as TechnicalDicomMetadata})),
});
const hash="a".repeat(64), hashes=[0,1].map(i=>({sopInstanceUid:"1.2.3."+i,sha256:hash}));
const evidence:EvidenceJson={schema:"opus-evidence/v1",modality:"CT",coverage:"partially_assessed",
 seriesReviewed:["1.2.3"],warnings:["research-only"],findings:[{
   findingId:"f1",sign:"ICH candidate",anatomy:"brain",status:"candidate",
   source:{seriesUid:"1.2.3",sopInstanceUid:"1.2.3.1",frameIndex:0,slicePositionMm:1},
   measurements:{diameterMm:3,volumeMl:null},
   model:{id:"ianpan",provider:"local",version:"e6d89c2"},limitations:[],
 }]};
const ich=createNativePhysicianDraft(make("CT"),{kind:"ianpan-ich",result:evidence},
 {"ich-0":"accepted"},"Сверено врачом",hashes,"2026-10-28T00:00:00Z");
assert.equal(ich.status,"unsigned_research_only");
assert.equal(ich.sourceDicomSha256[0].sha256,hash);
assert.equal(ich.findings.length,1);
assert.equal(ich.findings[0].physicianDecision,"accepted");
assert.equal(ich.findings[0].sourceSopInstanceUid,"1.2.3.1");
assert.ok(ich.limitations.some(s=>s.includes("отсутствие кандидатов")));
const wmhResult:BoundWmh={sourceHash:"b".repeat(64),checkpointHash:"c".repeat(64),totalMl:0.3,
 components:[{component:4,voxels:2,volumeMl:0.3,
   sourceVoxelBoundsInclusive:[[0,0,0],[1,1,1]],
   centroidNiftiRasMm:[10,20,30]}]};
const wmh=createNativePhysicianDraft(make("MR"),{kind:"wmh-flair",result:wmhResult},
 {"wmh-4":"rejected"},"FLAIR-находка неспецифична",hashes,"2026-10-28T00:00:00Z");
assert.equal(wmh.findings[0].physicianDecision,"rejected");
assert.equal(wmh.provenance.checkpointSHA256,"c".repeat(64));
assert.equal(wmh.findings[0].sourceSopInstanceUid,"1.2.3.0");
assert.throws(()=>createNativePhysicianDraft(make("CT"),{kind:"ianpan-ich",result:evidence},
 {},"",hashes,"2026-10-28T00:00:00Z"));
assert.throws(()=>createNativePhysicianDraft(make("CT"),{kind:"ianpan-ich",result:evidence},
 {},"test",hashes.slice(1),"2026-10-28T00:00:00Z"));
assert.throws(()=>createNativePhysicianDraft(make("CT"),{kind:"ianpan-ich",result:evidence},
 {},"test",[{...hashes[0],sha256:"bad"},hashes[1]],"2026-10-28T00:00:00Z"));
assert.throws(()=>createNativePhysicianDraft(make("CT"),{kind:"ianpan-ich",result:{
 ...evidence,findings:[{...evidence.findings[0],source:{...evidence.findings[0].source,sopInstanceUid:"foreign"}}]}},
 {},"test",hashes,"2026-10-28T00:00:00Z"));
assert.throws(()=>createNativePhysicianDraft(make("CT"),{kind:"wmh-flair",result:wmhResult},
 {},"test",hashes,"2026-10-28T00:00:00Z"));
console.log("PASS unsigned original-DICOM physician report with ICH/WMH, UID, SHA, decisions and source rejection");
