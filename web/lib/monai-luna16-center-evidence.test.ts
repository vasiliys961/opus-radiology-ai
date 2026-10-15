import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import type {MonaiResearchReport} from "./pathology-findings";
import {validateMonaiRealCenterEvidence} from "./monai-luna16-center-evidence.ts";
const source=JSON.parse(readFileSync(new URL("../public/examples/luna16-monai-cpu-run-38436406805.json",import.meta.url),"utf-8")) as MonaiResearchReport;
const observed=JSON.parse(readFileSync(new URL("../public/examples/luna16-monai-expert-center-run-38724788094.json",import.meta.url),"utf-8"));
const gt=observed.independentPublishedLuna16ExpertReference;
const index=observed.geometry.noduleReferenceSourceVoxel;
const spacing=[.78125,.78125,2.5];
const reference={
 sourceSeriesIdSha256:source.publicStudy.sourceSeriesIdSha256,
 sourceMhdSha256:source.publicStudy.sourceMhdSha256,
 annotationsSha256:observed.study.annotationsSha256,
 sourceGeometry:{
  origin:gt.centerLpsMm.map((v:number,i:number)=>v-index[i]*spacing[i]),
  spacingMm:spacing,
  directionMatrix:[[1,0,0],[0,1,0],[0,0,1]],
  dimensions:[512,512,109],
 },
 referenceNodules:[{centerMm:gt.centerLpsMm,diameterMm:gt.diameterMm,
  nativeVoxelIndex:index}],
};
const clone=()=>JSON.parse(JSON.stringify(observed));
test("genuine model and expert center bound to source CT; 0.884mm evidence",()=>{
 const result=validateMonaiRealCenterEvidence(observed,source,reference);
 assert.equal(result.modelCandidatesCompared[0].centerDistanceToExpertMm,0.884);
 assert.equal(result.modelCandidatesCompared[0].rawUncalibratedScore,0.981209);
 assert.equal(result.independentPublishedLuna16ExpertReference.diameterMm,5.10512);
 assert.equal(result.researchReferenceCenterHitAtScorePoint5,true);
 assert.deepEqual(result.researchCenterHitCandidateIndices,[0]);
 assert.equal(result.independentClinicalValidation,false);
 assert.equal(result.datasetHoldoutFromModelTrainingVerified,false);
 assert.equal(result.dice,null);
});
test("tampering with comparison, source or diagnosis is rejected",()=>{
 const a=clone();
 a.modelCandidatesCompared[0].centerDistanceToExpertMm=10;
 assert.throws(()=>validateMonaiRealCenterEvidence(a,source,reference),/измеренный/);
 const b=clone();b.study.sourceRawSha256="a".repeat(64);
 assert.throws(()=>validateMonaiRealCenterEvidence(b,source,reference),/исходным/);
 const c=clone();c.independentClinicalValidation=true;
 assert.throws(()=>validateMonaiRealCenterEvidence(c,source,reference),/исходным/);
 const d=clone();d.modelCandidatesCompared[0].referenceCenterMatchAtScorePoint5=false;
 assert.throws(()=>validateMonaiRealCenterEvidence(d,source,reference),/измеренный/);
 const e=clone();e.researchCenterHitCandidateIndices=[];
 assert.throws(()=>validateMonaiRealCenterEvidence(e,source,reference),/Недостоверное/);
});
