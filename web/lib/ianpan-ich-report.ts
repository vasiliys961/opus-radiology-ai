/** Imported research-only ICH classifier/localizer JSON.
 * No imported JSON proves that model inference ran; no DICOM/SOP or native CT
 * alignment can be inferred from the model's 512×512 localization heatmap.
 */
export const ICH_CLASSES = [
  "epidural","intraparenchymal","intraventricular","subarachnoid","subdural","any",
] as const;
export type IchAlternativeClass=typeof ICH_CLASSES[number];
export const ICH_CLASS_LABELS:Record<IchAlternativeClass,string>={
  epidural:"Эпидуральное",intraparenchymal:"Внутримозговое",
  intraventricular:"Внутрижелудочковое",subarachnoid:"Субарахноидальное",
  subdural:"Субдуральное",any:"Любое внутричерепное",
};
export type IchAlternativeCandidate={
  sliceIndexModelOrdered:number;
  class:IchAlternativeClass;
  rawUncalibratedScore:number;
  heatmapPositivePixelsAtPoint5:number;
  modelInputBoundingBoxXY:[number,number,number,number]|null;
  localizationFrame:"preprocessed_512_model_input_not_source_voxel";
  clinicallyConfirmed:false;
  sourceVoxelProjection?:null|{
    boundingBoxNativeNiftiXYZ:[number,number,number,number,number,number];
    boundingBoxWorldRasMm:[number,number,number,number,number,number];
    projectionMethod:"vendor_e6d89c2_lps_reorientation_center_pad_inverse_v1";
    trimmedOutsideOriginalCT:boolean;
    independentlyClinicallyVerified:false;
    expertMaskCompared:false;
  };
};
export type IchAlternativeReport={
  schema:"opus-ianpan-genuine-public-ich-research/v1";
  status:"genuine_pretrained_inference_requires_independent_validation";
  model:{id:"ianpan/ct-head-hemorrhage-detection";revision:string;checkpointSha256Verified:true;sha256ByArtifact:Record<string,string>};
  source:{
    niftiSha256:string;sourceDimensionsXYZ:number[];modelOrderedSliceCount:number;
    publicRightsOperatorAttested:true;huProvenanceOperatorAttestedNotIndependentlyConfirmed:true;
    modelPixelsNotRegisteredToSource:true;
    researchRoiVoxelGeometryProjectionAvailable?:true;
    researchRoiClinicalValidation?:false;
    sourceOriginalDicomHURescaleIndependentlyVerified?:boolean;
    publishedFigshareHuLikeWithoutOriginalDicomRescaleAudit?:boolean;
    referenceLabelsOnlyPerihematomalEdema?:boolean;
  };
  runtime:{executionDevice:"cpu"|"cuda";elapsedSeconds:number};
  seriesRawUncalibratedScores:Record<IchAlternativeClass,number>;
  candidates:IchAlternativeCandidate[];
  thresholdForResearchListing:0.5;
  diagnosticInterpretation:"research_candidates_only";
  externalExpertHemorrhageLocalizationComparisonPerformed?:false;
  modelInputHeatmapsAreSourceAligned:false;
  sensitivity:null; specificity:null; dice:null;
  negativeDiagnosticConclusionAllowed:false;
  readyForClinicalUse:false;
};
const SHA=/^[a-f0-9]{64}$/;
const knownClasses=new Set<string>(ICH_CLASSES);
const MODEL_SHA="9792e50ad1d863e80a549d391ee53c5031d490abb75acba42d471b02a83fbafb";
function object(value:unknown,label:string):Record<string,unknown>{
 if(!value||typeof value!=="object"||Array.isArray(value))
   throw Error("Некорректный формат: "+label);
 return value as Record<string,unknown>;
}
function score(v:unknown):v is number {
 return typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=1;
}
function integer(v:unknown,low:number,high:number):v is number{
 return typeof v==="number"&&Number.isSafeInteger(v)&&v>=low&&v<=high;
}
export function parseIchAlternativeReport(raw:string):IchAlternativeReport{
 if(typeof raw!=="string"||raw.length>2*1024*1024)
   throw Error("Отчёт превышает 2 МиБ.");
 const root=object(JSON.parse(raw),"отчёт");
 const model=object(root.model,"модель"),source=object(root.source,"исходная КТ");
 const runtime=object(root.runtime,"инференс");
 const checks=object(model.sha256ByArtifact,"контроль весов");
 if(root.schema!=="opus-ianpan-genuine-public-ich-research/v1"||
    root.status!=="genuine_pretrained_inference_requires_independent_validation"||
    model.id!=="ianpan/ct-head-hemorrhage-detection"||
    model.revision!=="e6d89c2"||model.checkpointSha256Verified!==true||
    checks["inference.py"]!==MODEL_SHA||
    !SHA.test(String(source.niftiSha256))||
    !Array.isArray(source.sourceDimensionsXYZ)||
    source.sourceDimensionsXYZ.length!==3||
    source.sourceDimensionsXYZ.some(n=>!integer(n,8,512))||
    !integer(source.modelOrderedSliceCount,8,64)||
    source.publicRightsOperatorAttested!==true||
    source.huProvenanceOperatorAttestedNotIndependentlyConfirmed!==true||
    source.modelPixelsNotRegisteredToSource!==true||
    (source.researchRoiVoxelGeometryProjectionAvailable!==undefined&&
     source.researchRoiVoxelGeometryProjectionAvailable!==true)||
    (source.researchRoiClinicalValidation!==undefined&&
     source.researchRoiClinicalValidation!==false)||
    !["cpu","cuda"].includes(String(runtime.executionDevice))||
    typeof runtime.elapsedSeconds!=="number"||!Number.isFinite(runtime.elapsedSeconds)||
    runtime.elapsedSeconds<0||runtime.elapsedSeconds>100000||
    root.thresholdForResearchListing!==0.5||
    root.diagnosticInterpretation!=="research_candidates_only"||
    (root.externalExpertHemorrhageLocalizationComparisonPerformed!==undefined&&
     root.externalExpertHemorrhageLocalizationComparisonPerformed!==false)||
    (source.sourceOriginalDicomHURescaleIndependentlyVerified!==undefined&&
     typeof source.sourceOriginalDicomHURescaleIndependentlyVerified!=="boolean")||
    (source.publishedFigshareHuLikeWithoutOriginalDicomRescaleAudit!==undefined&&
     typeof source.publishedFigshareHuLikeWithoutOriginalDicomRescaleAudit!=="boolean")||
    (source.referenceLabelsOnlyPerihematomalEdema!==undefined&&
     typeof source.referenceLabelsOnlyPerihematomalEdema!=="boolean")||
    (source.publishedFigshareHuLikeWithoutOriginalDicomRescaleAudit===true&&
     (source.sourceOriginalDicomHURescaleIndependentlyVerified!==false||
      source.referenceLabelsOnlyPerihematomalEdema!==true||
      root.externalExpertHemorrhageLocalizationComparisonPerformed!==false))||
    root.modelInputHeatmapsAreSourceAligned!==false||
    root.sensitivity!==null||root.specificity!==null||root.dice!==null||
    root.negativeDiagnosticConclusionAllowed!==false||
    root.readyForClinicalUse!==false)
   throw Error("Неверный исследовательский статус модели или исходной КТ.");
 const classes=object(root.seriesRawUncalibratedScores,"классы");
 for(const key of ICH_CLASSES)if(!score(classes[key]))
   throw Error("Повреждён ряд оценок кровоизлияния: "+key);
 if(!Array.isArray(root.candidates)||root.candidates.length>384)
   throw Error("Недопустимое число срезовых кандидатов.");
 const seen=new Set<string>();
 for(const element of root.candidates){
   const c=object(element,"срезовая находка");
   if(!integer(c.sliceIndexModelOrdered,0,(source.modelOrderedSliceCount as number)-1)||
      typeof c.class!=="string"||!knownClasses.has(c.class)||
      !score(c.rawUncalibratedScore)||
      c.rawUncalibratedScore<0.5||
      !integer(c.heatmapPositivePixelsAtPoint5,0,262144)||
      c.localizationFrame!=="preprocessed_512_model_input_not_source_voxel"||
      c.clinicallyConfirmed!==false)
     throw Error("Некорректная исследовательская находка.");
   const key=c.sliceIndexModelOrdered+"/"+c.class;
   if(seen.has(key))throw Error("Повтор одной категории кровоизлияния на срезе.");
   seen.add(key);
   const box=c.modelInputBoundingBoxXY;
   if(box!==null&&(!Array.isArray(box)||box.length!==4||
      box.some(n=>!integer(n,0,511))||
      box[0]>box[2]||box[1]>box[3]||
      c.heatmapPositivePixelsAtPoint5===0))
     throw Error("Некорректная область модельной карты.");
   if(box===null&&c.heatmapPositivePixelsAtPoint5!==0)
     throw Error("Нет границ карты с ненулевыми пикселями.");
   if(c.sourceVoxelProjection!==undefined){
     if(source.researchRoiVoxelGeometryProjectionAvailable!==true)
       throw Error("Нет источника для исследовательской проекции.");
     if(c.sourceVoxelProjection!==null){
       const p=object(c.sourceVoxelProjection,"проекция на исходную NIfTI");
       if(box===null||p.projectionMethod!=="vendor_e6d89c2_lps_reorientation_center_pad_inverse_v1"||
          typeof p.trimmedOutsideOriginalCT!=="boolean"||
          p.independentlyClinicallyVerified!==false||p.expertMaskCompared!==false)
         throw Error("Недостоверный статус проекции на исходную КТ.");
       const vox=p.boundingBoxNativeNiftiXYZ;
       const ras=p.boundingBoxWorldRasMm;
       if(!Array.isArray(vox)||vox.length!==6||
          vox.some((v,i)=>!integer(v,0,(source.sourceDimensionsXYZ as number[])[i%3]-1))||
          vox.slice(0,3).some((v,i)=>v>vox[i+3])||
          !Array.isArray(ras)||ras.length!==6||
          ras.some(v=>typeof v!=="number"||!Number.isFinite(v)||Math.abs(v)>10000)||
          ras.slice(0,3).some((v,i)=>v>ras[i+3]))
         throw Error("Некорректные границы проекции NIfTI.");
     }
   }
 }
 // These assertions describe the IMPORTED author's research JSON contract;
 // trust/independent runtime authenticity still require external audit.
 return root as unknown as IchAlternativeReport;
}
