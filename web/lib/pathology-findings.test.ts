import test from "node:test";
import assert from "node:assert/strict";
import {
  startPathologyReview, recordPathologyAssessment, setPathologySynthesis,
  type MonaiResearchReport,
} from "./pathology-findings.ts";

const validReport=():MonaiResearchReport=>({
  schema:"opus-monai-luna16-real-single-ct-inference/v1",
  publicStudy:{
    sourceSeriesIdSha256:"a".repeat(64),sourceMhdSha256:"b".repeat(64),
    sourceRawSha256:"c".repeat(64),dimensions:[512,512,109],
    luna16GroundTruthNoduleCount:1,
  },
  coverage:{sourceFullCtProcessed:true,sourceWorldCoordinateVerification:"not_yet_completed"},
  model:{id:"monai-lung-nodule-ct-retinanet",version:"0.6.9",
    weightsSha256:"d".repeat(64),modelCheckpointActualSha256Verified:true},
  candidates:[{candidateIndex:0,centerMonaiWorldMm:[-63.9,-5.2,-85.1],
    extentMm:[4.9,4.7,5],rawClassificationScore:0.981209,
    coordinateFrameVerifiedAgainstSource:false}],
  readyForClinicalUse:false,
});

test("real-like MONAI findings retain model provenance but cannot claim a clinical diagnosis",()=>{
  const r=startPathologyReview(validReport());
  assert.equal(r.findings.length,1);
  assert.equal(r.findings[0].model.rawUncalibratedScore,0.981209);
  assert.equal(r.caseBinding.sourcePixelsSha256,"c".repeat(64));
  assert.equal(r.findings[0].source.sopInstanceUid,null);
  assert.equal(r.findings[0].localization.verifiedDicomLpsMm,null);
  assert.equal(r.automatedDiagnosis,false);
  assert.equal(r.clinicallyValidated,false);
  assert.equal(r.absenceOfDiseaseEstablished,false);
  assert.equal(r.externalTransmission,false);
});

test("physician can reject or request image review without changing model proposals",()=>{
  const initial=startPathologyReview(validReport());
  const id=initial.findings[0].findingId;
  const reviewed=recordPathologyAssessment(initial,id,
    {decision:"needs_image_review",note:"Check source axial slices",
      reviewerMeasuredDiameterMm:5.3},"2026-10-13T17:00:00.000Z");
  assert.equal(reviewed.events.length,1);
  assert.equal(reviewed.events[0].revision,1);
  assert.equal(reviewed.findings[0].assessment.reviewerMeasuredDiameterMm,5.3);
  assert.equal(reviewed.findings[0].model.rawUncalibratedScore,0.981209);
  assert.equal(initial.findings[0].assessment.decision,"unreviewed");
  const dismissed=recordPathologyAssessment(reviewed,id,
    {decision:"rejected_by_reviewer",note:"Not sufficient",
      reviewerMeasuredDiameterMm:null},"2026-10-13T17:05:00.000Z");
  assert.equal(dismissed.events.length,2);
  assert.equal(dismissed.events[1].previous.decision,"needs_image_review");
  assert.equal(dismissed.events[1].next.decision,"rejected_by_reviewer");
  assert.equal(recordPathologyAssessment(dismissed,id,dismissed.findings[0].assessment,
    "2026-10-13T17:05:00.000Z"),dismissed);
  assert.equal(setPathologySynthesis(dismissed,"Needs source CT").physicianSynthesis,"Needs source CT");
});

test("tampered or duplicate candidates and missing public-source hashes cannot be reviewed",()=>{
  assert.throws(()=>startPathologyReview({...validReport(),coverage:{
    sourceFullCtProcessed:true,sourceWorldCoordinateVerification:"verified"}}),/исследовательскому/);
  const r=validReport();
  assert.throws(()=>startPathologyReview({...r,candidates:[r.candidates[0],r.candidates[0]]}),/Повтор/);
  assert.throws(()=>startPathologyReview({...r,publicStudy:{...r.publicStudy,sourceRawSha256:"invalid"}}),/SHA-256/);
  assert.throws(()=>startPathologyReview({...r,candidates:[{...r.candidates[0],
    coordinateFrameVerifiedAgainstSource:true as never}]}),/Повтор|повреждение/);
});

test("invalid measurements, findings and comments fail without mutating reviewer records",()=>{
  const original=startPathologyReview(validReport());
  const id=original.findings[0].findingId;
  assert.throws(()=>recordPathologyAssessment(original,id,{
    decision:"needs_image_review",note:"a".repeat(1501),reviewerMeasuredDiameterMm:null
  },"2026-10-13T17:00:00.000Z"),/review note/);
  assert.throws(()=>recordPathologyAssessment(original,id,{
    decision:"needs_image_review",note:"",reviewerMeasuredDiameterMm:-2
  },"2026-10-13T17:00:00.000Z"),/диаметр/);
  assert.throws(()=>recordPathologyAssessment(original,"other-study",{
    decision:"unreviewed",note:"",reviewerMeasuredDiameterMm:null
  },"2026-10-13T17:00:00.000Z"),/не относится/);
  assert.throws(()=>setPathologySynthesis(original,"x".repeat(4001)),/synthesis/);
  assert.equal(original.events.length,0);
});

test("zero findings is never an automated negative conclusion",()=>{
  const r=startPathologyReview({...validReport(),candidates:[]});
  assert.equal(r.findings.length,0);
  assert.equal(r.absenceOfDiseaseEstablished,false);
  assert.equal(r.coverage.assessedAllPathologies,false);
});
