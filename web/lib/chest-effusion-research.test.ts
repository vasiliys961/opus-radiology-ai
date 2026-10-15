import assert from "node:assert/strict";
import test from "node:test";
import {parseEffusionResearchReport} from "./chest-effusion-research.ts";

const base=()=>{
 const dims:[number,number,number]=[32,32,12];
 const fluid=(id:2|3,voxels:number)=>( {
  labelId:id,pathologyClass:id===2?"pleural_effusion":"pericardial_effusion",
  modelPositiveNativeVoxelCount:voxels,
  modelUnvalidatedFluidLabelVolumeMl:voxels*.0015,
  nativeSourceSliceIndicesK:voxels?[3,4]:[],
  nativeIndexBoundsXYZMin:voxels?[5,6,3]:null,
  nativeIndexBoundsXYZMax:voxels?[8,9,4]:null,
  worldRasBoundsMmMin:voxels?[10,20,30]:null,
  worldRasBoundsMmMax:voxels?[14,24,35]:null,
  clinicalEffusionConfirmed:false,clinicalAbsenceIfEmptyEstablished:false
 });
 return {
  schema:"opus-real-totalseg-ct-effusion-source-proposals/v1",
  model:"TotalSegmentator",modelTask:"pleural_pericard_effusion",officialTaskId:315,
  modelCheckpointSha256ObservedNotSignedPublisherProof:"a".repeat(64),
  originalChestCtSha256:"b".repeat(64),
  modelOutputNativeMaskSha256:"c".repeat(64),
  originalCTDimensionsXYZ:dims,nativeSpatialUnits:"millimeters",
  sourceMaskMatchedAtEightPhysicalCornersWithinMm:.05,voxelVolumeMl:.0015,
  anatomicalClassLungPleuralIdOneExcludedFromPathology:true,
  anatomicalClassLungPleuralVoxelCountNotFluid:450,
  fluidCandidates:[fluid(2,12),fluid(3,8)],
  sourceDICOMRescaleIndependentlyVerified:false,clinicalValidation:false,
  clinicalNormalityCanBeConcluded:false,actualPretrainedInferenceProvenByThisMaskAlone:false,
  limitations:["research","model mask not independently proven","no DICOM SOP"]
 };
};
const parse=(r:ReturnType<typeof base>)=>parseEffusionResearchReport(JSON.stringify(r));
test("typed pleural and pericardial actual-label semantics; source-only bounding boxes are research",()=>{
 const report=parse(base());
 assert.equal(report.fluidCandidates.length,2);
 assert.equal(report.fluidCandidates[0].modelUnvalidatedFluidLabelVolumeMl,.018000000000000002);
 assert.equal(report.fluidCandidates[1].pathologyClass,"pericardial_effusion");
 assert.equal(report.anatomicalClassLungPleuralIdOneExcludedFromPathology,true);
 assert.equal(report.actualPretrainedInferenceProvenByThisMaskAlone,false);
 assert.equal(report.clinicalValidation,false);
});
test("reject task 315 anatomical label 1 misreported as fluid",()=>{
 const p=base();(p.fluidCandidates[0] as unknown as {labelId:number}).labelId=1;
 assert.throws(()=>parse(p),/Недопустимый класс/);
});
test("refuse fabricated clinical verification, mask-based normality or arbitrary model provenance",()=>{
 for(const change of [
   {clinicalValidation:true},{clinicalNormalityCanBeConcluded:true},
   {actualPretrainedInferenceProvenByThisMaskAlone:true},
   {modelCheckpointSha256ObservedNotSignedPublisherProof:"model-not-a-digest"},
   {sourceMaskMatchedAtEightPhysicalCornersWithinMm:25}
 ]){
   assert.throws(()=>parse({...base(),...change} as ReturnType<typeof base>),/Невозможно подтвердить/);
 }
});
test("refuse inconsistent physical label volume, slice bounds and duplicate labels",()=>{
 const a=base();a.fluidCandidates[0].modelUnvalidatedFluidLabelVolumeMl=12;
 assert.throws(()=>parse(a),/Подмена объёма/);
 const b=base();b.fluidCandidates[0].nativeSourceSliceIndicesK=[3,3];
 assert.throws(()=>parse(b),/сеткой/);
 const c=base();(c.fluidCandidates[1] as unknown as {labelId:number}).labelId=2;
 assert.throws(()=>parse(c),/Недопустимый класс/);
});
test("an empty segmentation is NOT a negative CT diagnosis",()=>{
 const p=base();
 p.fluidCandidates=p.fluidCandidates.map(x=>({...x,
  modelPositiveNativeVoxelCount:0,modelUnvalidatedFluidLabelVolumeMl:0,
  nativeSourceSliceIndicesK:[],
  nativeIndexBoundsXYZMin:null,nativeIndexBoundsXYZMax:null,
  worldRasBoundsMmMin:null,worldRasBoundsMmMax:null
 })) as typeof p.fluidCandidates;
 const report=parse(p);
 assert.equal(report.fluidCandidates[0].clinicalAbsenceIfEmptyEstablished,false);
 assert.equal(report.clinicalNormalityCanBeConcluded,false);
 assert.equal(report.fluidCandidates[0].modelPositiveNativeVoxelCount,0);
});
