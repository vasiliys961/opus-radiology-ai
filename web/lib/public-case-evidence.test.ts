import test from "node:test";
import assert from "node:assert/strict";
import {assemblePublicCase,parsePublicLLMReview,isPublicCaseId} from "./public-case-evidence.ts";

const H="a".repeat(64),K="b".repeat(64);
const realNodule={
 schema:"opus-monai-luna16-real-single-ct-inference/v1",
 status:"genuine_trained_checkpoint_executed_on_public_ct",
 publicStudy:{sourceRawSha256:H,sourceMhdSha256:K},
 model:{weightsSha256:H,modelCheckpointActualSha256Verified:true},
 coverage:{sourceFullCtProcessed:true},readyForClinicalUse:false,
 candidates:[{rawClassificationScore:0.91}],candidateCount:1,
};
const comparison={
 schema:"opus-monai-luna16-independent-expert-center-comparison/v1",
 model:{checkpointSha256:H},study:{sourceRawSha256:H},
 independentPublishedLuna16ExpertReference:{diameterMm:5.2},
 modelCandidatesCompared:[{centerDistanceToExpertMm:0.88,referenceCenterMatchAtScorePoint5:true}],
 independentClinicalValidation:false,datasetHoldoutFromModelTrainingVerified:false,
 researchReferenceCenterHitAtScorePoint5:true,
};
const head={
 schema:"opus-ianpan-genuine-public-ich-research/v1",
 source:{niftiSha256:H,referenceLabelsOnlyPerihematomalEdema:true},
 model:{checkpointSha256Verified:true},
 seriesRawUncalibratedScores:{intraparenchymal:0.98},
};
const bleed={
 schema:"opus-public-ich-independent-two-model-consistency/v1",
 originalCtSha256:H,secondModelMaskPositiveVoxels:10875,
 secondModelUnvalidatedMaskVolumeMl:12.964,
 secondModelMaskShareWithinFirstModelBounds:0.9988,
 independentRadiologistGroundTruthPresent:false,clinicalValidation:false,
 sourceHURescaleIndependentlyVerified:false,
};
test("Pinned public nodule localization facts are study-unbound",()=>{
 const result=assemblePublicCase("lung-nodule",realNodule,comparison);
 assert.equal(result.liveInference,false);
 assert.equal(result.patientStudyAnalyzed,false);
 assert.equal(result.clinicalValidation,false);
 assert.match(result.facts[2].detail,/0.880 мм/);
 assert.match(result.limitations.join(" "),/FROC/);
});
test("A different public source or model is rejected",()=>{
 assert.throws(()=>assemblePublicCase("lung-nodule",realNodule,{
  ...comparison,study:{sourceRawSha256:K},
 }),/provenance_mismatch/);
 assert.throws(()=>assemblePublicCase("lung-nodule",{...realNodule,readyForClinicalUse:true},comparison));
});
test("Two ICH model outputs are not represented as expert Dice",()=>{
 const result=assemblePublicCase("head-hemorrhage",head,bleed);
 assert.equal(result.liveInference,false);
 assert.match(result.facts.find(f=>f.id==="ich-model-agreement")?.detail??"",/НЕ Dice/);
 assert.match(result.limitations.join(" "),/нет|Нет/);
});
test("LLM must choose existing evidence IDs, never introduce a lesion",()=>{
 const data=assemblePublicCase("lung-nodule",realNodule,comparison);
 const correct=JSON.stringify({schema:"opus-public-llm-review/v1",
  rankedFacts:[{factId:"nodule-holdout",priority:"high",reason:"Нужен независимый тест."}],
  unresolvedQuestions:["Какая FROC на внешнем наборе?"],summary:"Research only: this is not a patient diagnosis."});
 assert.equal(parsePublicLLMReview(correct,data).rankedFacts[0].factId,"nodule-holdout");
 assert.throws(()=>parsePublicLLMReview(correct.replace("nodule-holdout","patient-cancer-location"),data),/unbound_llm_fact/);
});
test("Unknown case IDs cannot call a detector",()=>{
 assert.equal(isPublicCaseId("mr-hemorrhage"),false);
 assert.equal(isPublicCaseId("head-hemorrhage"),true);
});


const realTask315={
 schema:"opus-task315-public-ct-technical-run/v1",
 publicSource:"TCIA LCTSC CC BY 3.0, 103 supplied frames",
 sourceSha256:"99615ddb66e09bd46c2ff70c352d73414285145b358e448682b7cffc41249738",
 sourceSpatialGridVerified:true,modelTask:"pleural_pericard_effusion",
 actualPretrainedExecutionReported:true,modelPackageVersion:"2.18.0",
 installedCheckpointSha256:"c971fd018e32079a0d2abd9744f26e234d8778f6567c53ed948b22c21a1b84f0",
 activeCheckpointProven:false,anatomicalClass1NotCountedAsFluid:true,
 fluidClasses:[
   {class:"pleural_effusion",modelVoxelCount:0,unvalidatedModelVolumeMl:0},
   {class:"pericardial_effusion",modelVoxelCount:11211,unvalidatedModelVolumeMl:32.074897},
 ],elapsedSeconds:75.312,
 expertPleuralEffusionMaskCompared:false,anatomicalFullChestCoverageVerified:false,
 normalStudyEstablished:false,clinicalValidation:false,
};
test("real pretrained task315 shows fluid proposal without diagnosing effusion or absence",()=>{
 assert.equal(isPublicCaseId("chest-effusion"),true);
 const report=assemblePublicCase("chest-effusion",realTask315,null);
 assert.equal(report.clinicalValidation,false);
 assert.equal(report.patientStudyAnalyzed,false);
 assert.equal(report.liveInference,false);
 assert.match(report.facts.find(f=>f.id==="fluid-pericardial")?.detail??"",/32.075 мл/);
 assert.match(report.facts.find(f=>f.id==="fluid-pleural")?.detail??"",/НЕ исключает/);
 assert.match(report.limitations.join(" "),/ложноположительные/);
 const review=JSON.stringify({schema:"opus-public-llm-review/v1",
   rankedFacts:[{factId:"fluid-reference",priority:"high",reason:"Нужна экспертная сегментация."}],
   unresolvedQuestions:["Есть ли независимый клинический эталон?"],summary:"Public research only, not a diagnosis."});
 assert.equal(parsePublicLLMReview(review,report).rankedFacts[0].factId,"fluid-reference");
});
test("task315 public review rejects forged labels, clinical certainty and weight drift",()=>{
 for(const forged of [
  {...realTask315,sourceSha256:"0".repeat(64)},
  {...realTask315,installedCheckpointSha256:"0".repeat(64)},
  {...realTask315,clinicalValidation:true},
  {...realTask315,activeCheckpointProven:true},
  {...realTask315,normalStudyEstablished:true},
  {...realTask315,fluidClasses:[realTask315.fluidClasses[1],realTask315.fluidClasses[0]]},
  {...realTask315,fluidClasses:[realTask315.fluidClasses[0],{
    ...realTask315.fluidClasses[1],modelVoxelCount:9999}]},
 ])assert.throws(()=>assemblePublicCase("chest-effusion",forged,null));
});
