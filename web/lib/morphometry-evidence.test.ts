import test from "node:test";
import assert from "node:assert/strict";
import {validateMorphometryReport} from "./morphometry-evidence.ts";
const hash="a".repeat(64);
test("Cardio source-mask measurements remain anatomical and numerically bounded",()=>{
 const x=validateMorphometryReport({schema:"opus-native-cardiovascular-CT-anatomy-measurements/v1",sourceCTSHA256:hash,clinicallyValidated:false,
  measurements:{aorta:{maskEmpty:false,volumeMl:21.01,candidateAxialDiameterMm:23.6},heart:{maskEmpty:true,volumeMl:null}}});
 assert.equal(x.fields.length,2);
 assert.equal(x.sourceSha256,hash);
 assert.equal(x.clinicalValidation,false);
});
test("Lumbar HU, liver/spleen and hip reports have truthful labels",()=>{
 const spine=validateMorphometryReport({schema:"opus-vertebral-opportunistic-native-CT-HU/v1",originalSourceCTSHA256:hash,clinicallyValidated:false,
  measures:{L1:{attenuationHU:{median:117}}}});
 assert.match(spine.fields[0].label,/L1/);
 const liver=validateMorphometryReport({schema:"opus-noncontrast-native-CT-liver-spleen-HU/v1",originalCtSHA256:hash,clinicallyValidated:false,
  liver:{HU:{median:48}},spleen:{HU:{median:62}},liverMinusSpleenMedianHU:-14});
 assert.equal(liver.fields.length,3);
 const hip=validateMorphometryReport({schema:"opus-hip-proximal-femur-pelvis-source-mask-separation/v1",sourceCTSHA256:hash,clinicallyValidated:false,
  jointSide:"right",distanceToPelvicBoneMaskMm:{min:2.5,median:4.2}});
 assert.equal(hip.fields.length,2);
});
test("WMH requires TRUE original trained forward and model hash",()=>{
 assert.throws(()=>validateMorphometryReport({schema:"opus-original-wmh-source-MRI-CPU-research/v1",
  sourceFLAIRSHA256:hash,clinicallyValidated:false,realTrainedOriginalWMHModelForwardCompleted:false,
  checkpointSHA256:hash,candidateComponentCount:2,totalPredictedHyperintensityMl:0.1}),/инференс/);
 const x=validateMorphometryReport({schema:"opus-original-wmh-source-MRI-CPU-research/v1",sourceFLAIRSHA256:hash,clinicallyValidated:false,
  realTrainedOriginalWMHModelForwardCompleted:true,checkpointSHA256:hash,candidateComponentCount:2,totalPredictedHyperintensityMl:0.1});
 assert.equal(x.fields.length,2);
});
test("WMH original expert scoring is internally recomputed and never promoted to clinical evidence",()=>{
 const overlap={
  originalExpertWMHMaskSHA256:"b".repeat(64),sameOriginalNativeGrid:true,
  clinicalValidation:false,singleCaseResearchScoreNotIndependentValidation:true,
  tp:36,fp:11,fn:12,tn:12200,expertOtherPathologyLabel2ExcludedVoxels:1,
  dice:72/95,sensitivity:36/48,precision:36/47
 };
 const data={
  schema:"opus-original-wmh-source-MRI-CPU-research/v1",sourceFLAIRSHA256:hash,clinicallyValidated:false,
  realTrainedOriginalWMHModelForwardCompleted:true,checkpointSHA256:hash,
  candidateComponentCount:2,totalPredictedHyperintensityMl:.15,
  trainingOverlapIndependentlyExcluded:false,originalExpertOverlap:overlap
 };
 const report=validateMorphometryReport(data);
 assert.equal(report.fields.length,9);
 assert.match(report.fields[5].label,/Dice/);
 assert.match(report.fields[5].value,/75,789/);
 assert.equal(report.clinicalValidation,false);
 assert.throws(()=>validateMorphometryReport({...data,realTrainedOriginalWMHModelForwardCompleted:false}),/инференс/);
 assert.throws(()=>validateMorphometryReport({...data,originalExpertOverlap:{...overlap,dice:0.99}}),/не совпадают/);
 assert.throws(()=>validateMorphometryReport({...data,originalExpertOverlap:{...overlap,tp:36.5}}),/нецелые/);
 assert.throws(()=>validateMorphometryReport({...data,originalExpertOverlap:{...overlap,expertOtherPathologyLabel2ExcludedVoxels:-1}}),/вне диапазона/);
 assert.throws(()=>validateMorphometryReport({...data,trainingOverlapIndependentlyExcluded:true}),/исследовательское/);
});
test("True WMH 3D component recall is source-bound, recomputed and descriptive only",()=>{
 const overlap={
  originalExpertWMHMaskSHA256:"b".repeat(64),sameOriginalNativeGrid:true,
  clinicalValidation:false,singleCaseResearchScoreNotIndependentValidation:true,
  tp:6672,fp:5864,fn:82,tn:2838198,expertOtherPathologyLabel2ExcludedVoxels:0,
  dice:13344/(13344+5864+82),sensitivity:6672/6754,precision:6672/12536,
  expertLesionComponents26Connectivity:70,
  predictedLesionComponents26Connectivity:41,
  matchedExpertLesionsAnyVoxelOneToOne:37,
  missedExpertLesions:33,unmatchedPredictedLesionComponents:4,
  lesionRecallAnyOverlap:37/70,falsePositiveComponentsPerStudy:4,
  singleCaseAnyVoxelOverlapNotValidatedDetection:true,
  otherPathologyLabel2ExcludedFromComponentScoring:true,
  independentHoldout:false
 };
 const data={schema:"opus-original-wmh-source-MRI-CPU-research/v1",
  sourceFLAIRSHA256:hash,clinicallyValidated:false,checkpointSHA256:"c".repeat(64),
  realTrainedOriginalWMHModelForwardCompleted:true,candidateComponentCount:41,
  totalPredictedHyperintensityMl:12.1,trainingOverlapIndependentlyExcluded:false,
  originalExpertOverlap:overlap};
 const valid=validateMorphometryReport(data);
 assert.equal(valid.fields.length,14);
 assert.match(valid.fields.find(x=>x.label.includes("recall компонентов"))?.value??"",/52,857/);
 assert.match(valid.warnings.join(" "),/26-связным/);
 assert.match(valid.warnings.join(" "),/НЕ подтверждённая врачом/);
 assert.throws(()=>validateMorphometryReport({...data,originalExpertOverlap:{...overlap,lesionRecallAnyOverlap:.99}}),/не совпадают/);
 assert.throws(()=>validateMorphometryReport({...data,originalExpertOverlap:{...overlap,missedExpertLesions:2}}),/не совпадают/);
 assert.throws(()=>validateMorphometryReport({...data,originalExpertOverlap:{...overlap,independentHoldout:true}}),/исследовательское/);
 assert.throws(()=>validateMorphometryReport({...data,originalExpertOverlap:{...overlap,predictedLesionComponents26Connectivity:2}}),/не совпадают/);
 assert.throws(()=>validateMorphometryReport({...data,originalExpertOverlap:{...overlap,otherPathologyLabel2ExcludedFromComponentScoring:false}}),/исследовательское/);
});
test("Real Bouget LyNoS expert case shows genuine LOW Dice and rejects counterfeit metrics",()=>{
 const real={
  schema:"opus-real-bouget-mediastinal-UNet-SW32-LyNoS-P3/v1",
  sourceCTSHA256:"d".repeat(64),originalPublicCtSHA256:"d".repeat(64),
  expertLabelSHA256:"e".repeat(64),originalPredictionSHA256:"f".repeat(64),
  originalArchiveSHA256:"a".repeat(64),
  clinicallyValidated:false,wholeCTOriginalModelForwardCompleted:true,
  maskGeometryExact:true,caseCount:1,patientCloudTransfer:false,
  gpuUsed:false,notIndependentHoldout:true,lesionRecallValidated:false,
  model:"Bouget-UNet-SW32",publisherOutputClass:"LymphNodes",
  sourceType:"research_public_contrast_enhanced_CT",
  probabilityThreshold:0.4,
  referencePositiveVoxels:9425,predictedVoxels:2935,
  TP:244,FP:2691,FN:9181,voxelDice:488/12360,
  connectedNodeAnalysisCompleted:true,
  connectedNodeAnalysisSkippedResourceGuard:false,
  expertConnectedComponents26:6,predictedConnectedComponents26:13,
  matchedReferenceComponentsOneToOne:3,
  unmatchedPredictionComponents:10,missedReferenceComponents:3,
  connectedComponentRecallAnyVoxel:.5,
  connectedComponentMatchingCriterion:"26-neighbor any-voxel overlap; one-to-one greedy",
  independentClinicalNodeRecallValidated:false
 };
 const accepted=validateMorphometryReport(real);
 assert.equal(accepted.sourceSha256,real.sourceCTSHA256);
 assert.equal(accepted.fields.length,11);
 assert.match(accepted.fields.find(x=>x.label.includes("Dice"))?.value??"",/3,948/);
 assert.match(accepted.warnings.join(" "),/низкий/);
 assert.match(accepted.warnings.join(" "),/НЕ является подтверждённой/);
 assert.throws(()=>validateMorphometryReport({...real,wholeCTOriginalModelForwardCompleted:false}),/инференс/);
 assert.throws(()=>validateMorphometryReport({...real,originalPublicCtSHA256:"1".repeat(64)}),/SHA-256/);
 assert.throws(()=>validateMorphometryReport({...real,voxelDice:.9}),/Dice/);
 assert.throws(()=>validateMorphometryReport({...real,FN:2}),/не совпадают/);
 assert.throws(()=>validateMorphometryReport({...real,connectedComponentRecallAnyVoxel:.8}),/не совпадает/);
 assert.throws(()=>validateMorphometryReport({...real,independentClinicalNodeRecallValidated:true}),/чувствительность/);
 assert.throws(()=>validateMorphometryReport({...real,clinicallyValidated:true}),/клиническую/);
 const memoryGuarded=validateMorphometryReport({...real,connectedNodeAnalysisCompleted:false,
  connectedNodeAnalysisSkippedResourceGuard:true});
 assert.equal(memoryGuarded.fields.length,6);
 assert.match(memoryGuarded.warnings.join(" "),/ограничения памяти/);
});
test("Gallbladder hyperattenuation candidate output never becomes diagnosis",()=>{
 const x=validateMorphometryReport({schema:"opus-CT-gallbladder-hyperattenuation-candidate/v1",sourceCTSHA256:hash,
  clinicallyValidated:false,thresholdHU:180,candidates:[{candidateIndex:0}]});
 assert.equal(x.fields.length,2);
 assert.match(x.warnings.join(" "),/диагноз/);
});
test("Aortic centerline geometry is shown as mask-only profile, NEVER diagnosed AAA",()=>{
 const legitimate={schema:"opus-aortic-centerline-orthogonal-anatomy-candidates/v1",
  sourceCTSHA256:hash,clinicallyValidated:false,
  noAneurysmOrAorticDiseaseDiagnosis:true,
  measurementsAreInteriorSegmentationNotExternalWallCalipers:true,
  genuineModelForwardPerformedByThisScript:false,
  numberOfReviewedOrthogonalPlanes:5,
  orthogonalProfile:Array.from({length:5},(_,i)=>({originalSourceSliceIndex:i+10})),
  maximumSampledMaskFeretMm:32.4,
  maximumSampledMaskAreaEquivalentDiameterMm:28.7};
 const observed=validateMorphometryReport(legitimate);
 assert.equal(observed.fields.length,3);
 assert.equal(observed.clinicalValidation,false);
 assert.match(observed.fields[1].label,/анатомической маски/);
 assert.throws(()=>validateMorphometryReport({...legitimate,noAneurysmOrAorticDiseaseDiagnosis:false}),/диагноз/);
 assert.throws(()=>validateMorphometryReport({...legitimate,maximumSampledMaskFeretMm:NaN}),/числовая/);
 assert.throws(()=>validateMorphometryReport({...legitimate,numberOfReviewedOrthogonalPlanes:6}),/количество/);
});
test("Real TotalSpineSeg two original models and exact disc labels are required",()=>{
 const levels=["T12-L1","L1-L2","L2-L3","L3-L4","L4-L5","L5-S"];
 const genuine={
  schema:"opus-true-original-TotalSpineSeg-disc-cord-MRI/v1",
  sourceMRI_SHA256:hash,clinicallyValidated:false,
  realTwoStagePretrainedCPUMRIForwardCompleted:true,
  noMRIStenosisOrDiscHerniationDiagnosis:true,
  publisherModelArchives:[
   {authorZipSHA256:hash,installedFold0CheckpointSHA256:hash},
   {authorZipSHA256:hash,installedFold0CheckpointSHA256:hash}
  ],
  discCandidates:levels.map((disc,i)=>({disc,present:i===1,volumeMl:i===1?2.43:undefined})),
  spinalCordMaskVoxels:923,spinalCanalMaskVoxels:1841
 };
 const report=validateMorphometryReport(genuine);
 assert.equal(report.sourceSha256,hash);
 assert.equal(report.fields.length,4);
 assert.equal(report.clinicalValidation,false);
 assert.throws(()=>validateMorphometryReport({...genuine,realTwoStagePretrainedCPUMRIForwardCompleted:false}),/инференс/);
 assert.throws(()=>validateMorphometryReport({...genuine,publisherModelArchives:[]}),/обе/);
 assert.throws(()=>validateMorphometryReport({...genuine,discCandidates:[...genuine.discCandidates].reverse()}),/уровня/);
});
test("Reject unknown schema, malformed SHA, fake validation and NaN",()=>{
 const input={schema:"opus-native-cardiovascular-CT-anatomy-measurements/v1",sourceCTSHA256:hash,clinicallyValidated:false,
  measurements:{aorta:{maskEmpty:false,volumeMl:42}}};
 assert.throws(()=>validateMorphometryReport({...input,schema:"foo"}),/схема/);
 assert.throws(()=>validateMorphometryReport({...input,sourceCTSHA256:"123"}),/SHA/);
 assert.throws(()=>validateMorphometryReport({...input,clinicallyValidated:true}),/клиническую/);
 assert.throws(()=>validateMorphometryReport({...input,measurements:{aorta:{volumeMl:NaN}}}),/числовая/);
});
