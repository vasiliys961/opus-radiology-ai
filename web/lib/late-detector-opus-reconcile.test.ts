import test from "node:test";
import assert from "node:assert/strict";
import {PILOT_GEMINI,PILOT_OPUS,type SanitizedModelReview} from "./sanitized-cloud-review.ts";
import {TASKS_BY_REGION,type SanitizedDetectorBundle} from "./detector-consilium-evidence.ts";
import {reconcileLateDetectorEvidence,validatedPriorVision,validateLateDetectorReconciliation} from "./late-detector-opus-reconcile.ts";
const hash="a".repeat(64);
const ids=["frame-1","frame-2"];
const bundle:SanitizedDetectorBundle={
 schema:"opus-sanitized-detector-consilium/v1",
 modality:"CT",region:"chest",
 facts:TASKS_BY_REGION.chest.map(task=>task==="lung_tumor"
  ?{task,status:"completed",candidateCount:1,candidateVolumeMl:2.304}
  :{task,status:"not_assessed",candidateCount:null,candidateVolumeMl:null}),
 sourceIdentifiersSent:false,sourcePixelsSent:false,clinicalValidation:false,negativeDiagnosisPermitted:false,
};
function review():SanitizedModelReview{
 return {
  schema:"opus-sanitized-cloud-pilot/v1",modality:"CT",coverage:"sampled-frames-only",
  results:(["gemini","opus"] as const).map(reviewer=>({
   reviewer,model:reviewer==="gemini"?PILOT_GEMINI:PILOT_OPUS,
   review:{role:"observations",reviewedImageIds:[...ids],observations:[{
    id:reviewer+"-one",imageId:"frame-1",anatomy:"right lung",
    sign:"uncertain dense focus",uncertainty:"limited axial PNG"}],
    limitations:["Sampled CT only"]},
  })),
  sourceFrames:ids.map(imageId=>({imageId,reviewedPixelSha256:hash})),
  callsAttempted:2,originalDicomSent:false,sourceDicomIdentifiersSent:false,
  clinicalReviewRequired:true,deidentificationIndependentlyCertified:false,
  patientDataCanStillBeSensitive:true,researchOnly:true,diagnosticAccuracyValidated:false,
 };
}
test("late real CLN candidate reconciles with earlier sampled Vision using ONE Opus text call, ZERO pixels",async()=>{
 let calls=0;
 const r=await reconcileLateDetectorEvidence(review(),bundle,async request=>{
   calls++;
   assert.equal(request.provider,"openrouter");
   assert.equal(request.role,"reasoning");
   assert.equal(request.model,PILOT_OPUS);
   assert.equal(request.maxTokens,1400);
   const sent=JSON.stringify(request.messages);
   assert.ok(sent.includes("lung_tumor"));
   assert.ok(sent.includes("2.304"));
   assert.ok(sent.includes("uncertain dense focus"));
   assert.doesNotMatch(sent,/image_url|data:image|sourceFrames|reviewedPixelSha256|[a-f0-9]{64}|SOPInstanceUID|PatientName/);
   return {choices:[{finish_reason:"stop",message:{
     content:JSON.stringify({summary:"Предварительный текст для врача, CLN 2.304 мл.",
      limitations:["Находка не является диагнозом; оценивались только отдельные кадры."]}),
   }}]};
 });
 assert.equal(calls,1);
 assert.equal(r.imagePixelsResent,false);
 assert.equal(r.originalDicomSent,false);
 assert.equal(r.draft.summary.includes("2.304"),true);
 assert.ok(validateLateDetectorReconciliation(r,bundle,ids));
});
test("refuse stale frames, unexecuted candidate, model swap and wrong modality before external call",async()=>{
 let called=false;
 const no=async()=>{called=true;return {choices:[]}};
 const bad=review();
 bad.results[0].review.reviewedImageIds=["frame-1"];
 await assert.rejects(()=>reconcileLateDetectorEvidence(bad,bundle,no),/prior_vision_did_not_review_all_frames/);
 const swapped=review();swapped.results[1].model=PILOT_GEMINI;
 assert.throws(()=>validatedPriorVision(swapped,bundle),/prior_source_bound_vision_result_not_verified/);
 const wrong={...bundle,modality:"MR" as const};
 await assert.rejects(()=>reconcileLateDetectorEvidence(review(),wrong,no));
 const missing={...bundle,facts:bundle.facts.map(f=>({...f,status:"not_assessed" as const,candidateCount:null,candidateVolumeMl:null}))};
 await assert.rejects(()=>reconcileLateDetectorEvidence(review(),missing,no));
 assert.equal(called,false);
});
test("source pixel digests may be used for local binding but cannot become extra model facts",()=>{
 const a=review();
 a.sourceFrames[0].reviewedPixelSha256="not-a-hash";
 assert.throws(()=>validatedPriorVision(a,bundle),/prior_sampled_frames_not_verified/);
 const b=review();
 b.results[0].review.observations[0].imageId="frame-unknown";
 assert.throws(()=>validatedPriorVision(b,bundle));
});
