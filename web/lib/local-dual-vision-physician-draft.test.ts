import test from "node:test";
import assert from "node:assert/strict";
import {buildLocalDualReviewDraft,findingReviewKey} from "./local-dual-vision-physician-draft.ts";
import type {SanitizedModelReview} from "./sanitized-cloud-review.ts";
const SHA1="a".repeat(64),SHA2="b".repeat(64);
const local=[{imageId:"frame-1",reviewedPixelSha256:SHA1},{imageId:"frame-2",reviewedPixelSha256:SHA2}];
const privateIds=["PRIVATE-LOCAL-STUDY-SLICE-1","PRIVATE-LOCAL-STUDY-SLICE-2"];
const role=(id:string,imageId:string)=>({
 role:"observations" as const,reviewedImageIds:["frame-1","frame-2"],
 observations:[{id,imageId,anatomy:"sampled axial chest",sign:"requires inspection",
  uncertainty:"incomplete frame coverage"}],limitations:["no negative scan established"]});
function source():SanitizedModelReview{
 return {schema:"opus-sanitized-cloud-pilot/v1",modality:"CT",coverage:"sampled-frames-only",
  results:[{reviewer:"gemini",model:"google/gemini-3.8-flash",review:role("gemini1","frame-1")},
   {reviewer:"opus",model:"anthropic/claude-opus-5.5",review:role("opus1","frame-2")}],
  sourceFrames:local.map(f=>({imageId:f.imageId,reviewedPixelSha256:f.reviewedPixelSha256})),
  callsAttempted:2,originalDicomSent:false,sourceDicomIdentifiersSent:false,
  clinicalReviewRequired:true,deidentificationIndependentlyCertified:false,
  patientDataCanStillBeSensitive:true,researchOnly:true,diagnosticAccuracyValidated:false,
  specialistEvidence:{model:"lungmask-R231",frameCount:32,rightLungMaskMl:1200,
   leftLungMaskMl:1100,clinicalProvenanceServerVerified:false,findingOfPathologyEstablished:false}};
}
test("Independent clinician adjudication retains original Gemini/Opus source IDs and numeric R231, but no patient DICOM ID",()=>{
 const r=source(),k=findingReviewKey("gemini","frame-1","gemini1");
 const d=buildLocalDualReviewDraft(r,local,privateIds,{
   [k]:{decision:"needs_original_source_recheck",note:"Compare to local native slices"},
 },"No case-wide diagnostic decision.");
 assert.equal(d.observations[0].review.decision,"needs_original_source_recheck");
 assert.equal(d.observations[1].review.decision,"unreviewed");
 assert.equal(d.provenance.sourceImagePixelSHA256[0],SHA1);
 assert.equal(d.specialistEvidence?.rightLungMaskMl,1200);
 assert.equal(d.discordantFrameCounts[0].gemini,1);
 assert.equal(d.discordantFrameCounts[1].opus,1);
 assert.equal(d.absenceOfDiseaseEstablished,false);
 assert.equal(d.automaticDiagnosis,false);
 assert.equal(d.externalTransmission,false);
 for(const id of privateIds)assert.doesNotMatch(JSON.stringify(d),new RegExp(id));
});
test("Changed original pixel hash, swapped source or unknown decision cannot be exported",()=>{
 const r=source();
 const corrupt=[
  {r,frame:[{...local[0],reviewedPixelSha256:SHA2},local[1]],d:{}},
  {r:{...r,sourceFrames:[r.sourceFrames[1],r.sourceFrames[0]]},frame:local,d:{}},
  {r,frame:local,d:{"gemini:frame-1:invented":{decision:"rejected_by_local_reviewer",note:""}}},
 ];
 for(const v of corrupt)assert.throws(()=>buildLocalDualReviewDraft(v.r as SanitizedModelReview,v.frame,privateIds,v.d as never,""));
});
test("Reviewer cannot assert diagnosis with a malformed decision/status; no extra model calls",()=>{
 const r=source(),k=findingReviewKey("opus","frame-2","opus1");
 assert.throws(()=>buildLocalDualReviewDraft(r,local,privateIds,{
  [k]:{decision:"confirmed_cancer" as never,note:""}
 },""),/invalid_clinician_assessment/);
 assert.throws(()=>buildLocalDualReviewDraft(r,local,privateIds,{},"x".repeat(4001)),/invalid_local_physician_draft/);
 assert.throws(()=>buildLocalDualReviewDraft(r,local,privateIds,{
  [k]:{decision:"rejected_by_local_reviewer",note:"x".repeat(501)}
 },""),/invalid_clinician_assessment/);
});
test("Remote extra fields cannot inject unexpected sensitive R231 properties in a local draft",()=>{
 const r=source();
 (r.specialistEvidence as unknown as Record<string,unknown>).patientName="PHI SENTINEL";
 const draft=buildLocalDualReviewDraft(r,local,privateIds,{},"");
 assert.equal(JSON.stringify(draft).includes("PHI SENTINEL"),false);
 assert.equal(draft.clinicianIdentityVerified,false);
 assert.equal(draft.digitallySigned,false);
});
