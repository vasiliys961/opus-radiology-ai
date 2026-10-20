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
test("Reject unknown schema, malformed SHA, fake validation and NaN",()=>{
 const input={schema:"opus-native-cardiovascular-CT-anatomy-measurements/v1",sourceCTSHA256:hash,clinicallyValidated:false,
  measurements:{aorta:{maskEmpty:false,volumeMl:42}}};
 assert.throws(()=>validateMorphometryReport({...input,schema:"foo"}),/схема/);
 assert.throws(()=>validateMorphometryReport({...input,sourceCTSHA256:"123"}),/SHA/);
 assert.throws(()=>validateMorphometryReport({...input,clinicallyValidated:true}),/клиническую/);
 assert.throws(()=>validateMorphometryReport({...input,measurements:{aorta:{volumeMl:NaN}}}),/числовая/);
});
