import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {parseIchAlternativeReport} from "./ianpan-ich-report.ts";
import {parseIchBloodExpertSpatialReview} from "./ianpan-blood-reference.ts";

const realText=readFileSync(new URL(
  "../public/examples/ianpan-ich-real-figshare-run-38734338486.json",
  import.meta.url),"utf8");
const genuine=parseIchAlternativeReport(realText);
const realSha=createHash("sha256").update(realText).digest("hex");
function syntheticExpertResult(){
 const candidates=genuine.candidates.filter(c=>c.class==="intraparenchymal"&&
  c.sourceVoxelProjection!==null&&c.sourceVoxelProjection!==undefined);
 return {
  schema:"opus-ianpan-expert-hemorrhage-roi-spatial-comparison/v1",
  status:"authentic_model_roi_vs_operator_attested_original_hemorrhage_mask",
  referenceDescription:"HEMORRHAGE_BLOOD_NOT_EDEMA",
  evidenceHashes:{
   sourceCtSha256:genuine.source.niftiSha256,
   originalExpertMaskSha256:"a".repeat(64),
   originalOntologySha256:"b".repeat(64),
   modelResearchReportSha256:realSha
  },
  originalNativeShapeXYZ:[512,512,25],
  referenceGridMatchesSourceWithin005Mm:true,
  allOriginalCtSlicesAvailable:true,
  sourceResampled:false,
  modelCheckpointSha256VerifiedInSourceReport:true,
  referenceAnnotationAuthenticityIndependentlyAuditedByOpus:false,
  referenceRightsAttestedByOperator:true,
  comparisonMethod:"expert_blood_voxel_fraction_inside_union_of_model_source_bbox_envelopes",
  referenceClasses:[{
   referenceClass:"IPH",label:1,referencePositiveVoxels:200,
   expertReferenceVolumeMl:1.2,subtypeCandidateBoxes:candidates.length,
   maxRawUncalibratedScore:Math.max(...candidates.map(c=>c.rawUncalibratedScore)),
   expertVoxelsInsideModelBoxUnion:100,
   expertVoxelShareInsideModelBoxes:.5,
   expertComponentsWithBoxIntersection:1,expertComponentsTotal:2,
   modelBoundingBoxVoxelCountNotAValidHematomaVolume:600,
   expertReferenceNotCoveredVoxels:100,
   modelPredictedHematomaVolumeMl:null,
   modelVoxelsSegmentedWithIndependentExpertMask:false,
   geometricBoxContactIsClinicalTruePositive:false
  }],
  falsePositivePerCase:null,clinicalTruePositiveCount:null,
  modelPredictedHematomaVolumeMl:null,hematomaSegmentationDice:null,
  clinicalSensitivity:null,heldOutFromTrainingProven:false,
  sourceDICOMRescaleIndependentlyAudited:false,clinicalValidation:false,
  patientDiagnosticUseAllowed:false,
  limitations:["Synthetic blood reference used ONLY in test.","No real hematoma expert annotation exists for this study."]
 };
}
function read(x:ReturnType<typeof syntheticExpertResult>,sha=realSha){
 return parseIchBloodExpertSpatialReview(JSON.stringify(x),genuine,sha);
}
test("accepts separately hashed, blood-specific external report on genuine model evidence, NEVER clinical Dice",()=>{
 const x=read(syntheticExpertResult());
 assert.equal(x.referenceClasses[0].referenceClass,"IPH");
 assert.equal(x.referenceClasses[0].subtypeCandidateBoxes,7);
 assert.equal(x.referenceClasses[0].expertVoxelShareInsideModelBoxes,.5);
 assert.equal(x.clinicalTruePositiveCount,null);
 assert.equal(x.modelPredictedHematomaVolumeMl,null);
 assert.equal(x.hematomaSegmentationDice,null);
 assert.equal(x.clinicalValidation,false);
});
test("same original CT but tampered model report hash must fail closed",()=>{
 const x=syntheticExpertResult();
 assert.throws(()=>read(x,"c".repeat(64)),/соответствует настоящему/);
 x.evidenceHashes.sourceCtSha256="c".repeat(64);
 assert.throws(()=>read(x),/соответствует настоящему/);
});
test("reject fake model volume, fake Dice, true positive and mismatch subtype box count",()=>{
 const x=syntheticExpertResult();
 for(const change of [
   {hematomaSegmentationDice:.89},
   {clinicalTruePositiveCount:1},
   {modelPredictedHematomaVolumeMl:31},
   {clinicalValidation:true},
   {patientDiagnosticUseAllowed:true},
 ]){
  assert.throws(()=>read({...x,...change} as never),/соответствует настоящему/);
 }
 const wrong=syntheticExpertResult();
 wrong.referenceClasses[0].subtypeCandidateBoxes=17;
 assert.throws(()=>read(wrong),/Модельные области/);
});
test("reject invented expert voxel coverage, wrong label class and impossible blood",()=>{
 const a=syntheticExpertResult();
 a.referenceClasses[0].expertVoxelShareInsideModelBoxes=.99;
 assert.throws(()=>read(a),/Покрытие экспертных вокселей/);
 const b=syntheticExpertResult();
 b.referenceClasses[0].referenceClass="EDEMA";
 assert.throws(()=>read(b),/Экспертные метки/);
 const c=syntheticExpertResult();
 c.referenceClasses[0].referencePositiveVoxels=0;
 c.referenceClasses[0].expertVoxelsInsideModelBoxUnion=0;
 c.referenceClasses[0].expertVoxelShareInsideModelBoxes=null as never;
 c.referenceClasses[0].expertComponentsTotal=0;
 c.referenceClasses[0].expertComponentsWithBoxIntersection=0;
 c.referenceClasses[0].expertReferenceVolumeMl=0;
 assert.throws(()=>read(c),/Загруженный экспертный эталон/);
});
