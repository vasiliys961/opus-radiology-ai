import test from "node:test";
import assert from "node:assert/strict";
import {sanitizeClnTumorReport,validateSanitizedClnEvidence} from "./cln-tumor-consilium.ts";
const sha="a".repeat(64);
function report(){return {
  schema:"opus-original-CLN-native-DICOM-lung-tumor/v1",
  sourceDicomNiftiSha256:sha,checkpointSha256:"b".repeat(64),
  originalModelForwardCompleted:true,sourceDicomGeometryAccepted:true,
  originalDicomSopRegistrationVerified:false,researchOnly:true,
  clinicalValidation:false,negativeDiagnosisPermitted:false,
  sourceImageFilesUploadedToCloud:false,candidateListTruncated:false,
  candidateCount:1,nativeCandidates:[{
    candidateVolumeMl:2.304,
    sourceVoxelCentroidIJK:[12,13,14],
    patientName:"must-not-leak"
  }],
  sourceDicomPatientName:"must-not-leak"
};}
test("CLN converts real completed report into source-safe tumor-only evidence",()=>{
  const x=sanitizeClnTumorReport(report(),sha);
  assert.equal(x.task,"lung_tumor");
  assert.equal(x.candidateCount,1);
  assert.equal(x.candidateVolumeMl,2.304);
  assert.equal(validateSanitizedClnEvidence(x),true);
  assert.doesNotMatch(JSON.stringify(x),/patient|centroid|sha256|must-not-leak/i);
});
test("CLN rejects unmatched source, incomplete original model and truncated candidates",()=>{
  assert.throws(()=>sanitizeClnTumorReport(report(),"c".repeat(64)));
  assert.throws(()=>sanitizeClnTumorReport({...report(),originalModelForwardCompleted:false},sha));
  assert.throws(()=>sanitizeClnTumorReport({...report(),candidateListTruncated:true},sha));
  assert.throws(()=>sanitizeClnTumorReport({...report(),nativeCandidates:[{candidateVolumeMl:Infinity}]},sha));
});
test("CLN rejects extra provenance fields in already sanitized evidence",()=>{
  const clean=sanitizeClnTumorReport(report(),sha);
  assert.equal(validateSanitizedClnEvidence({...clean,sourceId:"private"}),false);
});
