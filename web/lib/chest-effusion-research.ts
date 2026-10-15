/** Research-only physician import for an ORIGINAL pretrained task-315 source mask.
 *
 * No clinical validation is created by importing a JSON. An anatomical
 * pleural label 1 is NEVER treated as fluid. A missing candidate is NOT a
 * negative diagnosis, and no DICOM SOP / patient study is automatically linked.
 */
export type EffusionResearchClass="pleural_effusion"|"pericardial_effusion";
export type EffusionResearchCandidate={
  labelId:2|3;
  pathologyClass:EffusionResearchClass;
  modelPositiveNativeVoxelCount:number;
  modelUnvalidatedFluidLabelVolumeMl:number;
  nativeSourceSliceIndicesK:number[];
  nativeIndexBoundsXYZMin:[number,number,number]|null;
  nativeIndexBoundsXYZMax:[number,number,number]|null;
  worldRasBoundsMmMin:[number,number,number]|null;
  worldRasBoundsMmMax:[number,number,number]|null;
  clinicalEffusionConfirmed:false;
  clinicalAbsenceIfEmptyEstablished:false;
};
export type EffusionResearchReport={
  schema:"opus-real-totalseg-ct-effusion-source-proposals/v1";
  model:"TotalSegmentator";
  modelTask:"pleural_pericard_effusion";
  officialTaskId:315;
  modelCheckpointSha256ObservedNotSignedPublisherProof:string;
  originalChestCtSha256:string;
  modelOutputNativeMaskSha256:string;
  originalCTDimensionsXYZ:[number,number,number];
  nativeSpatialUnits:"millimeters";
  sourceMaskMatchedAtEightPhysicalCornersWithinMm:0.05;
  voxelVolumeMl:number;
  anatomicalClassLungPleuralIdOneExcludedFromPathology:true;
  anatomicalClassLungPleuralVoxelCountNotFluid:number;
  fluidCandidates:[EffusionResearchCandidate,EffusionResearchCandidate];
  sourceDICOMRescaleIndependentlyVerified:false;
  clinicalValidation:false;
  clinicalNormalityCanBeConcluded:false;
  actualPretrainedInferenceProvenByThisMaskAlone:false;
  limitations:string[];
};
const obj=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Неверный объект исследования.");
  return value as Record<string,unknown>;
};
const sha=(value:unknown):value is string=>
  typeof value==="string"&&/^[0-9a-f]{64}$/.test(value);
const uint=(value:unknown):value is number=>
  typeof value==="number"&&Number.isSafeInteger(value)&&value>=0;
const positive=(value:unknown):value is number=>
  typeof value==="number"&&Number.isFinite(value)&&value>0;
const triple=(value:unknown):value is number[]=>Array.isArray(value)&&
  value.length===3&&value.every(v=>typeof v==="number"&&Number.isFinite(v));
function candidate(value:unknown,dims:number[],volume:number,expected:2|3):EffusionResearchCandidate{
  const v=obj(value);
  if(v.labelId!==expected||
     v.pathologyClass!==(expected===2?"pleural_effusion":"pericardial_effusion")||
     !uint(v.modelPositiveNativeVoxelCount)||
     !uint(v.modelUnvalidatedFluidLabelVolumeMl)&&
       !(typeof v.modelUnvalidatedFluidLabelVolumeMl==="number"&&
         Number.isFinite(v.modelUnvalidatedFluidLabelVolumeMl)&&
         v.modelUnvalidatedFluidLabelVolumeMl>=0)||
     !Array.isArray(v.nativeSourceSliceIndicesK)||
     v.nativeSourceSliceIndicesK.length>dims[2]||
     !v.nativeSourceSliceIndicesK.every(k=>uint(k)&&k<dims[2])||
     new Set(v.nativeSourceSliceIndicesK).size!==v.nativeSourceSliceIndicesK.length||
     v.clinicalEffusionConfirmed!==false||
     v.clinicalAbsenceIfEmptyEstablished!==false)
    throw Error("Недопустимый класс плеврального или перикардиального выпота.");
  const voxels=v.modelPositiveNativeVoxelCount as number;
  const labelVolume=v.modelUnvalidatedFluidLabelVolumeMl as number;
  if(Math.abs(labelVolume-voxels*volume)>0.0000011||
     (voxels===0 && (labelVolume!==0||v.nativeSourceSliceIndicesK.length!==0))||
     (voxels>0 && v.nativeSourceSliceIndicesK.length===0))
    throw Error("Подмена объёма или диапазона срезов модели.");
  if(voxels===0){
    if(v.nativeIndexBoundsXYZMin!==null||v.nativeIndexBoundsXYZMax!==null||
       v.worldRasBoundsMmMin!==null||v.worldRasBoundsMmMax!==null)
      throw Error("Для пустой модельной маски границы должны отсутствовать.");
  }else{
    const lower=v.nativeIndexBoundsXYZMin,upper=v.nativeIndexBoundsXYZMax;
    if(!triple(lower)||!triple(upper)||!lower.every(uint)||!upper.every(uint)||
       !lower.every((x,i)=>x<=upper[i]&&upper[i]<dims[i])||
       !triple(v.worldRasBoundsMmMin)||!triple(v.worldRasBoundsMmMax)||
       !(v.worldRasBoundsMmMin as number[]).every((x,i)=>x<=(v.worldRasBoundsMmMax as number[])[i])||
       (v.nativeSourceSliceIndicesK as number[])[0]!==lower[2]||
       (v.nativeSourceSliceIndicesK as number[]).at(-1)!==upper[2]||
       (v.nativeSourceSliceIndicesK as number[]).some((z,i,a)=>i>0&&z<=a[i-1]))
      throw Error("Кандидат не совпадает с исходной пространственной сеткой КТ.");
  }
  return v as EffusionResearchCandidate;
}
export function parseEffusionResearchReport(raw:string):EffusionResearchReport{
  if(raw.length<64||raw.length>512*1024)throw Error("Паспорт выпотов слишком большой или пуст.");
  let value:unknown;
  try{value=JSON.parse(raw);}catch{throw Error("Некорректный JSON результатов КТ.");}
  const r=obj(value);
  if(r.schema!=="opus-real-totalseg-ct-effusion-source-proposals/v1"||
     r.model!=="TotalSegmentator"||r.modelTask!=="pleural_pericard_effusion"||
     r.officialTaskId!==315||
     !sha(r.modelCheckpointSha256ObservedNotSignedPublisherProof)||
     !sha(r.originalChestCtSha256)||!sha(r.modelOutputNativeMaskSha256)||
     !triple(r.originalCTDimensionsXYZ)||
     !(r.originalCTDimensionsXYZ as number[]).every((d,i)=>uint(d)&&
       d>0&&d<=[512,512,300][i])||
     r.nativeSpatialUnits!=="millimeters"||
     r.sourceMaskMatchedAtEightPhysicalCornersWithinMm!==0.05||
     !positive(r.voxelVolumeMl)||
     r.anatomicalClassLungPleuralIdOneExcludedFromPathology!==true||
     !uint(r.anatomicalClassLungPleuralVoxelCountNotFluid)||
     r.sourceDICOMRescaleIndependentlyVerified!==false||
     r.clinicalValidation!==false||r.clinicalNormalityCanBeConcluded!==false||
     r.actualPretrainedInferenceProvenByThisMaskAlone!==false||
     !Array.isArray(r.limitations)||r.limitations.length<3||
     r.limitations.length>15||
     r.limitations.some(x=>typeof x!=="string"||x.length>750))
    throw Error("Невозможно подтвердить исходное происхождение маски и её исследовательские ограничения.");
  const dims=r.originalCTDimensionsXYZ as number[];
  const voxelVolume=r.voxelVolumeMl as number;
  if(dims.reduce((a,b)=>a*b,1)>512*512*300||
     !Array.isArray(r.fluidCandidates)||r.fluidCandidates.length!==2||
     r.anatomicalClassLungPleuralVoxelCountNotFluid>(dims[0]*dims[1]*dims[2]))
    throw Error("Недопустимые размеры или метки результата.");
  const p=candidate(r.fluidCandidates[0],dims,voxelVolume,2);
  const q=candidate(r.fluidCandidates[1],dims,voxelVolume,3);
  if(p.modelPositiveNativeVoxelCount+q.modelPositiveNativeVoxelCount+
     (r.anatomicalClassLungPleuralVoxelCountNotFluid as number)>dims[0]*dims[1]*dims[2])
    throw Error("Противоречивое число размеченных вокселей КТ.");
  return r as EffusionResearchReport;
}
