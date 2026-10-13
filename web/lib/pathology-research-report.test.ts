import test from "node:test";
import assert from "node:assert/strict";
import {startPathologyReview,recordPathologyAssessment,setPathologySynthesis,
  type MonaiResearchReport} from "./pathology-findings.ts";
import {buildPathologyResearchHtml} from "./pathology-research-report.ts";
const date="2026-10-13T18:00:00.000Z";
function report():MonaiResearchReport {
  return {
    schema:"opus-monai-luna16-real-single-ct-inference/v1",
    publicStudy:{sourceSeriesIdSha256:"a".repeat(64),sourceMhdSha256:"b".repeat(64),
      sourceRawSha256:"c".repeat(64),dimensions:[512,512,109],luna16GroundTruthNoduleCount:1},
    coverage:{sourceFullCtProcessed:true,sourceWorldCoordinateVerification:"not_yet_completed"},
    model:{id:"monai-lung-nodule-ct-retinanet",version:"0.6.9",
      weightsSha256:"d".repeat(64),modelCheckpointActualSha256Verified:true},
    candidates:[{candidateIndex:0,centerMonaiWorldMm:[1,2,3],extentMm:[4,5,6],
      rawClassificationScore:0.981209,coordinateFrameVerifiedAgainstSource:false}],
    readyForClinicalUse:false
  };
}
test("printable physician report contains separate model, image and clinician evidence without a diagnosis",t=>{
  t.mock.method(globalThis,"fetch",async()=>{throw Error("No network for report");});
  let draft=startPathologyReview(report());
  const f=draft.findings[0];
  draft=recordPathologyAssessment(draft,f.findingId,{decision:"needs_image_review",
    note:"Review source slices",reviewerMeasuredDiameterMm:5.5},date);
  draft=setPathologySynthesis(draft,"Pending source geometry");
  const before=JSON.stringify(draft);
  const html=buildPathologyResearchHtml(draft,date);
  for(const part of ["LUNA16","НЕУТВЕРЖДЁННЫЙ","5.5 мм","0.9812","1.00; 2.00; 3.00",
    "Review source slices","Pending source geometry","Локальная история",
    "DICOM","SOP","нет",draft.caseBinding.sourcePixelsSha256])assert.ok(html.includes(part),part);
  assert.doesNotMatch(html,/<script|<img|<iframe|<link|<a\s/i);
  assert.match(html,/default-src &apos;none&apos;/);
  assert.equal(JSON.stringify(draft),before);
});
test("no candidates does not become a negative medical conclusion",()=>{
 const r=report();r.candidates=[];
 const html=buildPathologyResearchHtml(startPathologyReview(r),date);
 assert.match(html,/НЕ отрицательное диагностическое заключение/);
 assert.match(html,/Отсутствие кандидатов не означает отсутствие заболевания/);
});
test("free-text HTML injection stays escaped and opaque properties are ignored",()=>{
 let d=startPathologyReview(report());
 const injection='<script>alert("x")</script><img src=x onerror="alert(2)">&';
 d=setPathologySynthesis(d,injection);
 d=recordPathologyAssessment(d,d.findings[0].findingId,{
   decision:"needs_image_review",note:injection,reviewerMeasuredDiameterMm:null
 },date);
 Object.defineProperty(d,"secretPatientData",{enumerable:true,get(){throw Error("Opaque getter executed");}});
 const html=buildPathologyResearchHtml(d,date);
 assert.doesNotMatch(html,/<script|<img|secretPatientData/);
 assert.match(html,/&lt;script&gt;/);
 assert.match(html,/&amp;/);
});
test("source mismatch and clinical claim cannot be silently printed",()=>{
 const d=startPathologyReview(report());
 assert.throws(()=>buildPathologyResearchHtml({...d,clinicallyValidated:true as never},date),/Неверный/);
 assert.throws(()=>buildPathologyResearchHtml({...d,findings:[
   {...d.findings[0],source:{...d.findings[0].source,sopInstanceUid:"unverified" as never}}
 ]},date),/Несовпадение/);
 assert.throws(()=>buildPathologyResearchHtml({...d,caseBinding:{
   ...d.caseBinding,sourcePixelsSha256:"wrong"
 }},date),/Несовпадение/);
});
