import test from "node:test";
import assert from "node:assert/strict";
import {LOCAL_DIAGNOSTIC_REVIEW_ENABLED,PATIENT_CLOUD_TRANSMISSION_RELEASED,
  evaluatePatientCloudRelease,evaluateLocalDiagnosticReview} from "./patient-cloud-policy.ts";

test("local source-bound CT/MR physician review enabled independently of external AI",()=>{
  assert.equal(LOCAL_DIAGNOSTIC_REVIEW_ENABLED,true);
  for(const modality of ["CT","MR"] as const){
    const result=evaluateLocalDiagnosticReview({modality,sourceBound:true,sourceChanged:false});
    assert.equal(result.permitted,true);
    assert.equal(result.cloudAllowed,false);
    assert.equal(result.automaticDiagnosis,false);
    assert.equal(result.signedConclusion,false);
  }
});
test("stale or unbound CT/MR source blocks local draft",()=>{
  assert.equal(evaluateLocalDiagnosticReview({modality:"CT",sourceBound:false,sourceChanged:false}).permitted,false);
  assert.equal(evaluateLocalDiagnosticReview({modality:"MR",sourceBound:true,sourceChanged:true}).permitted,false);
});
test("no simulated consent or browser flags release patient data to cloud",()=>{
  assert.equal(PATIENT_CLOUD_TRANSMISSION_RELEASED,false);
  const claimed=evaluatePatientCloudRelease({physicianAuthentication:true,studyConsent:true,
    dicomDeidentification:true,pixelPrivacy:true,providerJurisdiction:true,
    auditRetention:true,clinicalValidation:true});
  assert.equal(claimed.permitted,false);
  assert.ok(claimed.missing.includes("production-release-not-implemented"));
});
