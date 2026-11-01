/** Authentic same-job TCIA scanner-original DICOM -> CLN -> Gemini/Opus test.
 * Neither pixel data nor original patient/scan UIDs leave an artifact.
 * The original CT is publicly licensed research data, never a patient workflow.
 */
import assert from "node:assert/strict";
import {readFileSync,readdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {createPrivacyFrame,markPrivacyReview,buildVisionPrivacyPacket}
 from "../web/lib/vision-privacy.ts";
import {TASKS_BY_REGION,validateSanitizedDetectorBundle}
 from "../web/lib/detector-consilium-evidence.ts";
import {createClnFrameRelativeEvidence}
 from "../web/lib/cln-frame-relative-evidence.ts";
import {reviewSanitizedSamples,PILOT_GEMINI,PILOT_OPUS}
 from "../web/lib/sanitized-cloud-review.ts";
import {callAiGateway} from "../web/lib/ai-gateway.ts";
import {hasRadiologistReportSections} from "../web/lib/senior-radiologist-report.ts";

const CHAIN="bb4b90496cf2d83dac83e729ef271091962d532a18db201c6e2d99d42dcb5f61";
const MODEL="8c08ec796fa2b786fe99ddfad4fe6314e98fdd8820c59527be3c4105f7955d87";
if(process.env.RADIOLOGY_PUBLIC_TCIA_CLOUD_TRANSFER_APPROVED!=="1"||
  !process.env.OPENROUTER_API_KEY)throw Error("public_TCIA_or_model_provider_not_authorized");
const [numericPath,rasterPath,outputPath]=process.argv.slice(2);
if(!numericPath||!rasterPath||!outputPath||!outputPath.endsWith(".json"))
 throw Error("TCIA numeric proof, DICOM frame directory and output JSON required");
const proof=JSON.parse(readFileSync(numericPath,"utf8"));
const map=JSON.parse(readFileSync(join(rasterPath,"frame-relative-map.json"),"utf8"));
assert.equal(proof.schema,"opus-original-cln-TCIA-LCTSC-http-forward/v1");
assert.equal(proof.originalScannerDicom,true);
assert.equal(proof.exactOriginalDICOMSeriesSopBindingVerified,true);
assert.equal(proof.originalDICOMSourceChainSha256,CHAIN);
assert.equal(proof.originalCheckpointSHA256,MODEL);
assert.equal(proof.realOriginalModelForwardCompleted,true);
assert.equal(proof.authenticatedLocalHttpWorker,true);
assert.equal(proof.clinicalValidation,false);
assert.equal(proof.negativeDiagnosisPermitted,false);
assert.equal(proof.originalPixelDataSentToCloud,false);
assert.equal(map.originalScannerDicom,true);
assert.equal(map.originalDicomSopRegistrationVerified,true);
assert.equal(map.sourceOriginalTCIAChainSha256,CHAIN);
assert.equal(map.sourceImageSha256,proof.sourceNativeSha256);
assert.equal(map.detectorSourceImageSha256,proof.sourceNativeSha256);
assert.deepEqual(map.imageDimensions,[512,512,103]);
assert.equal(map.localSopBinding.length,4);
assert.equal(map.reviewedFrames.length,4);
const candidateCount=proof.candidateCount;
assert.ok(Number.isSafeInteger(candidateCount)&&candidateCount>=0&&candidateCount<=10);
assert.equal(candidateCount,proof.candidates.length);
const volume=proof.candidates.reduce((n,c)=>n+c.candidateVolumeMl,0);
const bundle={
 schema:"opus-sanitized-detector-consilium/v1",modality:"CT",region:"chest",
 facts:TASKS_BY_REGION.chest.map(task=>task==="lung_tumor"
  ?{task,status:"completed",candidateCount,candidateVolumeMl:volume}
  :{task,status:"not_assessed",candidateCount:null,candidateVolumeMl:null}),
 sourceIdentifiersSent:false,sourcePixelsSent:false,
 clinicalValidation:false,negativeDiagnosisPermitted:false,
};
assert.ok(validateSanitizedDetectorBundle(bundle));
const spatial=candidateCount?createClnFrameRelativeEvidence({
 sourceImageSha256:map.sourceImageSha256,
 detectorSourceImageSha256:map.detectorSourceImageSha256,
 imageDimensions:map.imageDimensions,
 alignment:"source-dicom-pixel-to-png",
 reviewedFrames:map.reviewedFrames,
 nativeCandidates:proof.candidates.map(c=>({
  componentId:c.componentId,
  sourceVoxelCentroidIJK:c.sourceVoxelCentroidIJK,
  candidateVolumeMl:c.candidateVolumeMl,
 })),
}):null;
if(spatial){
 assert.equal(spatial.originalDicomIdentifiersSent,false);
 assert.equal(spatial.originalDicomSopRegistrationVerified,false,
  "Provider receives no scanner registration attestation or original SOPs");
 assert.equal(spatial.candidateAnchors.length,candidateCount);
 assert.ok(spatial.candidateAnchors.some(c=>Math.abs(c.axialSliceOffset)<=.5));
}
const names=readdirSync(rasterPath).filter(n=>/^frame-[1-4]\.png$/.test(n)).sort();
assert.deepEqual(names,["frame-1.png","frame-2.png","frame-3.png","frame-4.png"]);
for(let i=0;i<4;i++){
 assert.equal(map.localSopBinding[i].frameId,"frame-"+(i+1));
 assert.match(map.localSopBinding[i].sop,/^[0-9]+(?:\.[0-9]+)+$/);
}
const frames=names.map((name,i)=>{
 const frame=createPrivacyFrame(readFileSync(join(rasterPath,name)),"frame-"+(i+1),"CT");
 // PUBLIC licensed source only. Automated assertion is NOT doctor signoff.
 return markPrivacyReview(markPrivacyReview(frame,"pixel",true),"visual",true);
});
const packet=buildVisionPrivacyPacket(frames,"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
let calls=0;const receipts=[];
const response=await reviewSanitizedSamples(packet,async(req,signal)=>{
 calls++;
 assert.ok(calls<=2,"two model requests maximum");
 assert.equal(req.provider,"openrouter");
 const sent=JSON.stringify(req.messages);
 for(const item of map.localSopBinding){
  assert.ok(!sent.includes(item.sop),"Original scanner UID MUST remain local");
 }
 assert.doesNotMatch(sent,/StudyInstanceUID|SOPInstanceUID|PatientName|FrameOfReferenceUID/);
 if(calls===1){
  assert.equal(req.model,PILOT_GEMINI);
  assert.doesNotMatch(sent,/candidateAnchors|axialSliceOffset|lung_tumor|sourceVoxelCentroidIJK/);
 }else{
  assert.equal(req.model,PILOT_OPUS);
  assert.ok(sent.includes("Prior source-checked Gemini observations"));
  assert.ok(sent.includes("lung_tumor"));
  assert.ok(sent.includes(String(candidateCount)));
  if(spatial)assert.ok(sent.includes("xFraction")&&sent.includes("axialSliceOffset"));
 }
 const out=await callAiGateway(req,signal);
 receipts.push({model:req.model,promptTokens:out.usage?.prompt_tokens??null,
   completionTokens:out.usage?.completion_tokens??null});
 return out;
},undefined,null,bundle,null,null,spatial);
assert.equal(calls,2);
assert.deepEqual(response.results.map(r=>r.reviewer),["gemini","opus"]);
assert.equal(response.detectorEvidence?.facts.find(f=>f.task==="lung_tumor")?.candidateCount,candidateCount);
assert.equal(response.opusSynthesis?.comparisons.length,1);
assert.ok(hasRadiologistReportSections(response.opusSynthesis?.summary));
assert.equal(response.opusSynthesis.clinicallyValidated,false);
assert.equal(response.frameRelativeClnEvidence===undefined,!spatial);
const output={
 schema:"opus-real-original-TCIA-DICOM-CLN-Gemini-Opus/v1",
 sourceCollection:"TCIA LCTSC",sourceLicense:"CC BY 3.0",
 originalScannerDicom:true,originalDICOMFrameCount:103,
 originalSourceFileSHA256Chain:CHAIN,
 trueOriginalDICOMToCLNPhysicalAndSopBindingVerified:true,
 originalCLNCheckpointSHA256:MODEL,
 currentRunFreshCLNForward:true,
 sourceNativeSha256:proof.sourceNativeSha256,
 candidateCount,candidateVolumeMl:volume,
 actualOpenRouterCalls:calls,models:receipts,
 sampledOriginalDICOMFrames:4,sourceCoverage:"sampled_frames_only",
 clinicalValidation:false,expertPositiveComparisonPerformed:false,
 originalDicomIdentifiersSentToProvider:false,
 geminiJson:response.results[0].review,opusJson:response.results[1].review,
 opusIntegratedSynthesis:response.opusSynthesis,
 numericDetectorTasks:response.detectorEvidence?.facts,
 frameRelativeClnCandidateAnchors:response.frameRelativeClnEvidence?.candidateAnchors??[],
};
writeFileSync(outputPath,JSON.stringify(output,null,2)+"\n",{flag:"wx",mode:0o600});
const txt=outputPath.slice(0,-5)+".txt";
writeFileSync(txt,response.opusSynthesis.summary.trim()+"\n",{flag:"wx",mode:0o600});
console.log("REAL SOURCE ORIGINAL TCIA DICOM -> FRESH CLN -> PAID GEMINI -> PAID OPUS REPORT PASS",
 JSON.stringify({originalDICOMFrameCount:103,actualOpenRouterCalls:calls,
 originalCLNForwardThisRun:true,candidateCount,
 originalScannerSopRegistration:true,clinicalValidation:false}));
