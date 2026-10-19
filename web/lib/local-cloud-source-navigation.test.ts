import test from "node:test";
import assert from "node:assert/strict";
import {bindLocalSanitizedReview,sourceFileForObservation,perFrameModelCoverage} from "./local-cloud-source-navigation.ts";
import type {SanitizedModelReview} from "./sanitized-cloud-review.ts";
const H="a".repeat(64),J="b".repeat(64);
const local=[{imageId:"frame-1",reviewedPixelSha256:H},{imageId:"frame-2",reviewedPixelSha256:J}];
const ids=["private-local-file-001","private-local-file-002"];
const role=(imageId:string,id:string)=>({
  role:"observations" as const,reviewedImageIds:["frame-1","frame-2"],
  observations:[{id,imageId,anatomy:"visible chest",sign:"uncertain finding",uncertainty:"two sampled images"}],
  limitations:["Incomplete CT, not a patient diagnosis"],
});
function report():SanitizedModelReview{
  return {schema:"opus-sanitized-cloud-pilot/v1",modality:"CT",coverage:"sampled-frames-only",
    results:[
      {reviewer:"gemini",model:"google/gemini-3.8-flash",review:role("frame-1","g1")},
      {reviewer:"opus",model:"anthropic/claude-opus-5.5",review:role("frame-2","o1")},
    ],
    sourceFrames:local.map(x=>({imageId:x.imageId,reviewedPixelSha256:x.reviewedPixelSha256})),
    callsAttempted:2,originalDicomSent:false,sourceDicomIdentifiersSent:false,
    clinicalReviewRequired:true,deidentificationIndependentlyCertified:false,
    patientDataCanStillBeSensitive:true,researchOnly:true,diagnosticAccuracyValidated:false};
}
test("Model observations navigate to true original DICOM file only in browser memory",()=>{
 const r=report();
 const map=bindLocalSanitizedReview(r,local,ids);
 assert.deepEqual([...map.entries()],[["frame-1","private-local-file-001"],["frame-2","private-local-file-002"]]);
 assert.equal(sourceFileForObservation(r,local,ids,"frame-1"),ids[0]);
 assert.equal(sourceFileForObservation(r,local,ids,"frame-2"),ids[1]);
 assert.deepEqual(perFrameModelCoverage(r),[
  {imageId:"frame-1",geminiFindings:1,opusFindings:0,clinicalAgreementEstablished:false},
  {imageId:"frame-2",geminiFindings:0,opusFindings:1,clinicalAgreementEstablished:false}
 ]);
 const outgoing=JSON.stringify(r);
 assert.doesNotMatch(outgoing,/private-local-file-00/);
});
test("Never navigate if exact pixel hash or frame order changed",()=>{
 const r=report();
 for(const forged of [
  {local:[{...local[0],reviewedPixelSha256:J},local[1]],files:ids},
  {local:[local[1],local[0]],files:ids},
  {local:[local[0],local[0]],files:ids},
  {local,files:[ids[0],ids[0]]},
  {local,files:[ids[0]]},
  {local:[local[0]],files:[ids[0]]},
 ])assert.throws(()=>bindLocalSanitizedReview(r,forged.local,forged.files),/different_or_changed|review_not_bound/);
});
test("Tampered cloud source hashes, forged extra frame and unknown observations fail closed",()=>{
 const r=report();
 for(const forged of [
  {...r,sourceFrames:[{...r.sourceFrames[0],reviewedPixelSha256:J},r.sourceFrames[1]]},
  {...r,sourceFrames:[r.sourceFrames[1],r.sourceFrames[0]]},
  {...r,sourceFrames:r.sourceFrames.slice(0,1)},
  {...r,originalDicomSent:true},
  {...r,sourceDicomIdentifiersSent:true},
  {...r,results:[{...r.results[0],review:{...r.results[0].review,
    observations:[{...r.results[0].review.observations[0],imageId:"frame-3"}]}},r.results[1]]},
 ])assert.throws(()=>bindLocalSanitizedReview(forged as SanitizedModelReview,local,ids));
 assert.throws(()=>sourceFileForObservation(r,local,ids,"frame-3"),/outside_local/);
});
test("LLM output that was never assessed on this source is not navigable",()=>{
 const r=report();
 const forged={...r,results:[
  {...r.results[0],review:{...r.results[0].review,reviewedImageIds:["frame-1"]}},
  r.results[1],
 ]} as SanitizedModelReview;
 assert.throws(()=>bindLocalSanitizedReview(forged,local,ids),/not_bound/);
});
