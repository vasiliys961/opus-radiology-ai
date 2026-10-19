/**
 * Native DICOM source-bound physician findings for intrathoracic masses.
 * This does NOT run a detector, measure pixels, diagnose malignancy, infer
 * lymph-node metastasis, or release any patient/DICOM identity to cloud.
 *
 * Existing MONAI LUNA16 nodule candidates are not validated for masses >30mm;
 * a radiograph-level "Mass" score is not CT localization.
 */
import type {DicomSeries} from "./dicom-series.ts";

export const THORACIC_MASS_KINDS={
 pulmonary_nodule:"Лёгочный узел (до 30 мм)",
 pulmonary_mass:"Образование лёгкого (свыше 30 мм)",
 mediastinal_mass:"Образование средостения",
 mediastinal_lymph_node:"Лимфоузел средостения",
 hilar_lymph_node:"Лимфоузел корня лёгкого",
 pleural_mass:"Очаговое образование плевры",
 chest_wall_mass:"Образование грудной стенки",
} as const;
export type ThoracicMassKind=keyof typeof THORACIC_MASS_KINDS;
export type ThoracicCompartment="lung"|"anterior_mediastinum"|"middle_mediastinum"|
  "posterior_mediastinum"|"hilum"|"pleura"|"chest_wall";
export type ThoracicFindingInput={
  kind:ThoracicMassKind;
  compartment:ThoracicCompartment;
  side:"left"|"right"|"midline"|"unknown";
  sliceOrdinal:number; // 1-based index into selected DicomSeries.members
  localSourceMemberId:string; // ONLY local memory; intentionally omitted from output
  readerConfirmed:true;
  origin:"physician_annotation"; // never impersonate an automatic model
  longestAxialMm:number|null;
  shortAxisMm:number|null;
  contrast:"contrast"|"noncontrast"|"unknown";
  attenuation:"soft_tissue"|"ground_glass"|"mixed"|"fat"|"calcified"|"unknown";
};
export type ThoracicFindingReview={
  kind:ThoracicMassKind;
  compartment:ThoracicCompartment;
  side:ThoracicFindingInput["side"];
  sourceSliceOrdinal:number;
  sourcePositionLpsMm:null; // don't fabricate physical LPS, series isn't enough
  longestAxialMm:number|null;
  shortAxisMm:number|null;
  contrast:ThoracicFindingInput["contrast"];
  attenuation:ThoracicFindingInput["attenuation"];
  origin:"physician_annotation";
  localization:"selected_original_CT_slice_not_voxel_mask";
  findingOfCancerEstablished:false;
  metastasisEstablished:false;
  observedByAutomaticDetector:false;
  caveats:string[];
};
export type ThoracicMassWorklist={
  schema:"opus-intrathoracic-masses-local-physician-worklist/v1";
  status:"local_unsigned_research_observations";
  modality:"CT";
  sourceBinding:"same_current_selected_chest_DICOM_series";
  selectedSeriesSliceCount:number;
  findings:ThoracicFindingReview[];
  completeThoraxReviewed:false;
  noMassesOrMetastasesEstablished:false;
  clinicalValidation:false;
  externalTransmission:false;
  originalDicomIdentifiersIncluded:false;
  limitations:string[];
};
const compartments:Record<ThoracicMassKind,readonly ThoracicCompartment[]>={
 pulmonary_nodule:["lung"],
 pulmonary_mass:["lung"],
 mediastinal_mass:["anterior_mediastinum","middle_mediastinum","posterior_mediastinum"],
 mediastinal_lymph_node:["anterior_mediastinum","middle_mediastinum","posterior_mediastinum"],
 hilar_lymph_node:["hilum"],
 pleural_mass:["pleura"],
 chest_wall_mass:["chest_wall"],
};
export function requireNativeChestCt(series:DicomSeries){
 if(!series||series.modality!=="CT"||!Array.isArray(series.members)||
   series.members.length===0||series.members.length>100000||
   series.members.some(m=>m.metadata.modality!=="CT"||m.metadata.bodyRegion!=="CHEST"||
     (m.metadata.numberOfFrames!==null&&m.metadata.numberOfFrames!==1)))
   throw Error("selected_original_chest_CT_required");
 const ids=series.members.map(m=>m.id);
 if(ids.some(id=>typeof id!=="string"||id.length===0)||new Set(ids).size!==ids.length)
   throw Error("invalid_local_source_member_ids");
}
const isKnown=(value:unknown,options:readonly string[])=>typeof value==="string"&&options.includes(value);
const positive=(v:unknown)=>v===null||(typeof v==="number"&&Number.isFinite(v)&&v>0&&v<=500);
export function interpretThoracicMasses(
 series:DicomSeries, observations:readonly ThoracicFindingInput[],
):ThoracicMassWorklist{
 requireNativeChestCt(series);
 if(!Array.isArray(observations)||observations.length>40)
   throw Error("too_many_unverified_thoracic_observations");
 const findings:ThoracicFindingReview[]=[];
 for(const raw of observations){
   const kind=raw?.kind as ThoracicMassKind;
   if(!raw||!Object.hasOwn(compartments,kind)||
      !isKnown(raw.compartment,compartments[kind])||
      !isKnown(raw.side,["left","right","midline","unknown"])||
      !isKnown(raw.contrast,["contrast","noncontrast","unknown"])||
      !isKnown(raw.attenuation,["soft_tissue","ground_glass","mixed","fat","calcified","unknown"])||
      raw.readerConfirmed!==true||raw.origin!=="physician_annotation"||
      !Number.isSafeInteger(raw.sliceOrdinal)||raw.sliceOrdinal<1||
      raw.sliceOrdinal>series.members.length||
      series.members[raw.sliceOrdinal-1]?.id!==raw.localSourceMemberId||
      !positive(raw.longestAxialMm)||!positive(raw.shortAxisMm)||
      (raw.longestAxialMm!==null&&raw.shortAxisMm!==null&&
        raw.shortAxisMm>raw.longestAxialMm))
     throw Error("intrathoracic_finding_not_bound_to_original_CT");
   if(raw.kind==="pulmonary_nodule"&&
      (raw.longestAxialMm===null||raw.longestAxialMm>30))
     throw Error("pulmonary_nodule_requires_diameter_at_most_30mm");
   if(raw.kind==="pulmonary_mass"&&
      (raw.longestAxialMm===null||raw.longestAxialMm<=30))
     throw Error("pulmonary_mass_requires_diameter_above_30mm");
   const caveats=[
     "Наблюдение введено врачом на исходном срезе; автоматическая патологическая детекция и 3D-маска не выполнялись.",
     "Отсутствие отмеченной находки не означает отрицательную КТ. Нужен полный просмотр всей серии.",
   ];
   if(raw.kind.includes("lymph_node")){
     if(raw.shortAxisMm===null)
       caveats.push("Короткая ось лимфоузла не измерена; размеры лимфаденопатии не классифицируются.");
     caveats.push("Метастатическое поражение лимфоузла не устанавливается по одному диаметру.");
   }
   if(raw.contrast!=="contrast"&&
      ["mediastinal_mass","mediastinal_lymph_node","hilar_lymph_node"].includes(raw.kind))
     caveats.push("Для оценки сосудистых структур и узлов средостения может потребоваться контрастная КТ.");
   if(raw.kind==="pulmonary_mass"||raw.kind==="pulmonary_nodule")
     caveats.push("Размер не устанавливает гистологию; 3D-границы и объём поражения пока не подтверждены.");
   findings.push({
     kind:raw.kind,compartment:raw.compartment,side:raw.side,
     sourceSliceOrdinal:raw.sliceOrdinal,sourcePositionLpsMm:null,
     longestAxialMm:raw.longestAxialMm,shortAxisMm:raw.shortAxisMm,
     contrast:raw.contrast,attenuation:raw.attenuation,
     origin:"physician_annotation",
     localization:"selected_original_CT_slice_not_voxel_mask",
     findingOfCancerEstablished:false,metastasisEstablished:false,
     observedByAutomaticDetector:false,caveats,
   });
 }
 return {
   schema:"opus-intrathoracic-masses-local-physician-worklist/v1",
   status:"local_unsigned_research_observations",modality:"CT",
   sourceBinding:"same_current_selected_chest_DICOM_series",
   selectedSeriesSliceCount:series.members.length,
   findings,completeThoraxReviewed:false,
   noMassesOrMetastasesEstablished:false,clinicalValidation:false,
   externalTransmission:false,originalDicomIdentifiersIncluded:false,
   limitations:[
     "Описаны только выбранные врачом исходные КТ-срезы без автоматической детекции.",
     "Нет доказанного трёхмерного объёма, маски опухоли или TNM-стадии.",
     "Длина и короткая ось вводятся врачом, а не вычисляются из DICOM вокселей.",
     "Нет автоматической передачи в OpenRouter/Gemini/Opus. Врач самостоятельно проверяет исходное исследование.",
   ],
 };
}
