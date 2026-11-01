/** REAL paid Gemini Vision -> Claude Opus source-pinned public research smoke.
 * Earlier authentic CLN CPU HTTP report from actions/runs/41231610839 is loaded
 * from its immutable GitHub artifact, NOT fabricated nor rerun here.
 * Plain NIfTI-derived PNGs do NOT demonstrate original DICOM SOP registration.
 * Output excludes original CT pixels, tokens, paths and patient identifiers.
 */
import assert from "node:assert/strict";
import {readFileSync,readdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {createPrivacyFrame,markPrivacyReview,buildVisionPrivacyPacket}
 from "../web/lib/vision-privacy.ts";
import {TASKS_BY_REGION,validateSanitizedDetectorBundle}
 from "../web/lib/detector-consilium-evidence.ts";
import {reviewSanitizedSamples,PILOT_GEMINI,PILOT_OPUS}
 from "../web/lib/sanitized-cloud-review.ts";
import {callAiGateway} from "../web/lib/ai-gateway.ts";
import {hasRadiologistReportSections} from "../web/lib/senior-radiologist-report.ts";
import {createClnFrameRelativeEvidence} from "../web/lib/cln-frame-relative-evidence.ts";

const derivedDicomMode=process.env.RADIOLOGY_VERIFIED_PUBLIC_DERIVED_DICOM==="1";
if(process.env.RADIOLOGY_PUBLIC_MSD_CLOUD_TRANSFER_APPROVED!=="1"||
   !process.env.OPENROUTER_API_KEY)throw Error("public_research_and_provider_auth_missing");
const [source,folder,output]=process.argv.slice(2);
if(!source||!folder||!output)throw Error("numeric artifact, public raster directory and report path required");
const evidence=JSON.parse(readFileSync(source,"utf8"));
assert.equal(evidence.schema,"opus-original-cln-private-http-positive-public-ct/v1");
assert.equal(evidence.originalWeightsVerified,true);
assert.equal(evidence.realOriginalModelForwardCompleted,true);
assert.equal(evidence.testedViaAuthenticatedLocalHttpWorker,true);
assert.equal(evidence.sourceBound,true);
assert.equal(evidence.sourceSha256Compressed,"08b7aa88ee9946b0bf0a5fcd08af1d9b7720c4295e4f900a3e2f13d5c3b6b694");
if(derivedDicomMode){
 assert.match(evidence.sourceSha256UploadedNative,/^[0-9a-f]{64}$/);
 assert.equal(evidence.derivedDicomSopRegistrationVerified,true);
 assert.equal(evidence.derivedDicomSourceNativeSHA256,evidence.sourceSha256UploadedNative);
}else{
 assert.equal(evidence.sourceSha256UploadedNative,"941745d629a2242abd373ebfe440bfaa557073233db7693ecb209f41489f8c88");
}
assert.equal(evidence.publisherCheckpointSHA256,"8c08ec796fa2b786fe99ddfad4fe6314e98fdd8820c59527be3c4105f7955d87");
assert.equal(evidence.originalDicomSopRegistrationVerified,false);
assert.equal(evidence.candidateCount,evidence.candidates.length);
assert.ok(evidence.candidates.length>0&&evidence.candidates.length<=10);
const candidateVolume=evidence.candidates.reduce((n,c)=>{
 assert.ok(Number.isFinite(c.candidateVolumeMl)&&c.candidateVolumeMl>0);
 return n+c.candidateVolumeMl;
},0);
const taskBundle={
 schema:"opus-sanitized-detector-consilium/v1",modality:"CT",region:"chest",
 facts:TASKS_BY_REGION.chest.map(task=>task==="lung_tumor"
   ?{task,status:"completed",candidateCount:evidence.candidateCount,candidateVolumeMl:candidateVolume}
   :{task,status:"not_assessed",candidateCount:null,candidateVolumeMl:null}),
 sourceIdentifiersSent:false,sourcePixelsSent:false,
 clinicalValidation:false,negativeDiagnosisPermitted:false,
};
assert.ok(validateSanitizedDetectorBundle(taskBundle));
const geometry=JSON.parse(readFileSync(join(folder,"frame-relative-map.json"),"utf8"));
assert.equal(geometry.sourceImageSha256,evidence.sourceSha256UploadedNative);
if(derivedDicomMode){
 assert.equal(geometry.detectorSourceImageSha256,evidence.sourceSha256UploadedNative);
 assert.equal(geometry.derivedDicomSopRegistrationVerified,true);
 assert.equal(geometry.originalDicomSopRegistrationVerified,false);
 assert.equal(geometry.scannerOriginalDicom,false);
 assert.equal(geometry.localSopBinding?.length,4);
 for(const [index,link] of geometry.localSopBinding.entries()){
   assert.equal(link.imageId,"frame-"+(index+1));
   assert.match(link.sop,/^[0-9.]{8,64}$/);
 }
}
const spatial=createClnFrameRelativeEvidence({...geometry,
 nativeCandidates:evidence.candidates.map(c=>({
  componentId:c.componentId,sourceVoxelCentroidIJK:c.sourceVoxelCentroidIJK,
  candidateVolumeMl:c.candidateVolumeMl,
 }))});
assert.equal(spatial.candidateAnchors.length,evidence.candidateCount);
assert.ok(spatial.candidateAnchors.some(x=>Math.abs(x.axialSliceOffset)<=.5),
 "one sampled frame must intersect CLN centroid axial plane");
const names=readdirSync(folder).filter(x=>/^frame-[1-4]\.png$/.test(x)).sort();
assert.deepEqual(names,["frame-1.png","frame-2.png","frame-3.png","frame-4.png"]);
const frames=names.map((name,i)=>{
 const f=createPrivacyFrame(readFileSync(join(folder,name)),"frame-"+(i+1),"CT");
 // Public-source CI test only; these marks are automated harness setup,
 // NOT a clinician's verified pixel review or a patient cloud authorization.
 return markPrivacyReview(markPrivacyReview(f,"pixel",true),"visual",true);
});
const packet=buildVisionPrivacyPacket(frames,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
let calls=0;const receipts=[];
const doc=await reviewSanitizedSamples(packet,async(req,signal)=>{
 calls++;
 assert.ok(calls<=2,"public research may make at most two paid requests");
 assert.equal(req.provider,"openrouter");
 if(calls===1){
   assert.equal(req.model,PILOT_GEMINI);
   assert.doesNotMatch(JSON.stringify(req.messages),/lung_tumor|2\\.303572|CLN-Segmenter|xFraction|candidateAnchors|axialSliceOffset/);
 }else{
   assert.equal(req.model,PILOT_OPUS);
   const sent=JSON.stringify(req.messages);
   assert.ok(sent.includes("lung_tumor"));
   assert.ok(sent.includes("candidateCount"));
   assert.ok(sent.includes("xFraction")&&sent.includes("yFraction"));
   assert.ok(sent.includes("axialSliceOffset"));
   assert.ok(sent.includes("candidateId"));
   assert.ok(sent.includes(spatial.candidateAnchors[0].frameId));
   assert.ok(sent.includes("Prior source-checked Gemini observations"));
 if(derivedDicomMode)
   for(const link of geometry.localSopBinding)
     assert.ok(!sent.includes(link.sop),"DICOM SOP must never reach cloud");
 }
 const res=await callAiGateway(req,signal);
 receipts.push({model:req.model,promptTokens:res.usage?.prompt_tokens??null,
   completionTokens:res.usage?.completion_tokens??null});
 return res;
},undefined,null,taskBundle,null,null,spatial);
assert.equal(calls,2);
assert.equal(doc.results.length,2);
assert.deepEqual(doc.results.map(r=>r.reviewer),["gemini","opus"]);
assert.equal(doc.opusSynthesis?.comparisons.length,1);
assert.equal(doc.opusSynthesis?.comparisons[0].task,"lung_tumor");
assert.equal(doc.opusSynthesis?.clinicallyValidated,false);
assert.equal(doc.detectorEvidence?.facts.find(f=>f.task==="lung_tumor")?.candidateCount,1);
assert.ok(doc.opusSynthesis?.summary);
assert.ok(hasRadiologistReportSections(doc.opusSynthesis.summary),
 "Actual Claude Opus must return a clinician-readable Russian radiology report, not a JSON recap");
assert.deepEqual(doc.frameRelativeClnEvidence,spatial);
assert.equal(doc.frameRelativeClnEvidence?.originalDicomSopRegistrationVerified,false);
const publicReport={
 schema:"opus-real-licensed-public-ct-cln-gemini-opus/v1",
 source:"MSD Task06 Lung, publicly licensed CC-BY-SA-4.0, study lung_043",
 originalCLNHttpWorkerRun:derivedDicomMode?null:41231610839,
 originalCLNHttpCheckpointSHA256:evidence.publisherCheckpointSHA256,
 originalPublicNiftiSHA256:evidence.sourceSha256Compressed,
 originalRealModelForwardCompleted:true,
 currentRunReusedVerifiedNumericArtifact:!derivedDicomMode,
 currentRunPerformedNewCLNForward:derivedDicomMode,
 originalDicomSopRegistrationVerified:false,
 sourceDerivedFromRealPublicPixelCT:derivedDicomMode,
 generatedDicomSopGeometryVerified:derivedDicomMode,
 originalScannerDicomTested:false,
 actualOpenRouterCalls:calls,models:receipts,
 sampledCTFrames:frames.length,sourceCoverage:"sampled_frames_only",
 geminiJson:doc.results[0].review,
 opusJson:doc.results[1].review,
 opusIntegratedSynthesis:doc.opusSynthesis,
 numericDetectorTasks:doc.detectorEvidence?.facts,
 clnSpatialCandidateAnchors:doc.frameRelativeClnEvidence?.candidateAnchors,
 independentClinicalValidation:false,
};
writeFileSync(output,JSON.stringify(publicReport,null,2)+"\n",{flag:"wx",mode:0o600});
assert.ok(output.endsWith(".json"),"report output must have .json suffix");
const reportPath=output.slice(0,-5)+".txt";
writeFileSync(reportPath,doc.opusSynthesis.summary.trim()+"\n",{flag:"wx",mode:0o600});
console.log("REAL PUBLIC MSD CLN + Gemini JSON + Opus structured synthesis SUCCESS",
 JSON.stringify({actualOpenRouterCalls:calls,
 models:receipts.map(r=>r.model),sampledCTFrames:frames.length,
 originalCLNForwardPreviouslyVerified:!derivedDicomMode,
 newCLNForwardThisRun:derivedDicomMode,originalDicomSopRegistrationVerified:false,
 clinicallyValidated:false,clnSpatialAnchorsSent:spatial.candidateAnchors.length}));
