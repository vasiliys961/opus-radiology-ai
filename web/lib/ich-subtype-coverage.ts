import type {IchReferenceComparison} from "./ich-reference-comparison";
import type {IchResearchReport} from "./ich-research";

/** Only ORIGINAL documented expert labels have hemorrhage subtype semantics.
 * SAMIHS is a binary model and does NOT classify ICH subtype.
 */
export type IchExpertSubtypeCoverage={
 schema:"opus-ich-original-expert-subtype-coverage/v1";
 sourceOriginalMulticlassExpertRequired:true;
 modelSubtypeClassifierExecuted:false;
 evidenceHashes:{
  sourceSha256:string;predictionSha256:string;expertMaskSha256:string;
  originalExpertMaskSha256:string;ontologySha256:string;
 };
 ontologySourceUrl:string;
 expertVoxelClasses:{
  sourceLabel:number;expertSubtype:"IPH"|"IVH"|"SAH"|"SDH"|"EDH";
  expertVoxels:number;expertVolumeMl:number;
  modelOverlappingExpertVoxels:number;modelMissedExpertVoxels:number;
  peakMissedSliceIndexK?:number|null;peakMissedSliceVoxels?:number|null;
  voxelCoverageFraction:number|null;modelPredictedSubtype:false;
 }[];
 totalExpertVoxels:number;totalOverlappingExpertVoxels:number;
 totalMissedExpertVoxels:number;clinicalSubtypeSensitivity:null;
 clinicianReviewRequired:true;
};
const object=(x:unknown):Record<string,unknown>=>{
 if(!x||typeof x!=="object"||Array.isArray(x))
   throw Error("Неверный паспорт покрытия классов кровоизлияния.");
 return x as Record<string,unknown>;
};
const integer=(x:unknown):x is number=>
 typeof x==="number"&&Number.isSafeInteger(x)&&x>=0;
const finite=(x:unknown):x is number=>
 typeof x==="number"&&Number.isFinite(x);
const hash=(x:unknown)=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
const subtypes=new Set(["IPH","IVH","SAH","SDH","EDH"]);

export function parseIchExpertSubtypeCoverage(raw:string,
  comparison:IchReferenceComparison,model:IchResearchReport
):IchExpertSubtypeCoverage{
 if(!raw.length||raw.length>1024*1024)throw Error("Слишком большой паспорт кровоизлияния.");
 const p=object(JSON.parse(raw)),h=object(p.evidenceHashes);
 const m=comparison.metrics,expected=m.truePositiveVoxels+m.falseNegativeVoxels;
 if(p.schema!=="opus-ich-original-expert-subtype-coverage/v1"||
    p.sourceOriginalMulticlassExpertRequired!==true||
    p.modelSubtypeClassifierExecuted!==false||
    p.clinicalSubtypeSensitivity!==null||
    p.clinicianReviewRequired!==true||
    h.sourceSha256!==comparison.evidenceHashes.sourceSha256||
    h.predictionSha256!==comparison.evidenceHashes.predictionSha256||
    h.expertMaskSha256!==comparison.evidenceHashes.expertMaskSha256||
    h.sourceSha256!==model.source.sha256||
    h.predictionSha256!==model.prediction.maskSha256||
    !hash(h.originalExpertMaskSha256)||!hash(h.ontologySha256)||
    !Array.isArray(p.expertVoxelClasses)||
    p.expertVoxelClasses.length<1||p.expertVoxelClasses.length>32||
    !integer(p.totalExpertVoxels)||p.totalExpertVoxels!==expected||
    !integer(p.totalOverlappingExpertVoxels)||
    p.totalOverlappingExpertVoxels!==m.truePositiveVoxels||
    !integer(p.totalMissedExpertVoxels)||
    p.totalMissedExpertVoxels!==m.falseNegativeVoxels)
   throw Error("Покрытие классов не связано с текущим экспертным сравнением.");
 if(typeof p.ontologySourceUrl!=="string"||p.ontologySourceUrl.length>512)
   throw Error("Отсутствует авторитетная онтология.");
 try{
   const url=new URL(p.ontologySourceUrl);
   if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash)
     throw Error("Неоднозначная онтология.");
 }catch{throw Error("Некорректный адрес онтологии.");}
 const rows=p.expertVoxelClasses as unknown[];
 const seen=new Set<number>();let previous=0;
 let all=0,overlap=0,missed=0;
 for(const entry of rows){
   const c=object(entry);
   if(!integer(c.sourceLabel)||c.sourceLabel<1||c.sourceLabel>65535||
      c.sourceLabel<=previous||seen.has(c.sourceLabel)||
      !subtypes.has(String(c.expertSubtype))||
      !integer(c.expertVoxels)||
      !integer(c.modelOverlappingExpertVoxels)||
      !integer(c.modelMissedExpertVoxels)||
      c.modelOverlappingExpertVoxels+c.modelMissedExpertVoxels!==c.expertVoxels||
      !finite(c.expertVolumeMl)||
      Math.abs(c.expertVolumeMl-c.expertVoxels*model.source.geometry.voxelVolumeMl)>0.0000011||
      c.modelPredictedSubtype!==false)
     throw Error("Несогласованная исходная экспертная метка.");
   const fraction=c.expertVoxels>0?
      c.modelOverlappingExpertVoxels/c.expertVoxels:null;
   if(fraction===null?c.voxelCoverageFraction!==null:
     !finite(c.voxelCoverageFraction)||
     Math.abs(c.voxelCoverageFraction-fraction)>1e-9)
     throw Error("Некорректное воксельное покрытие класса.");
   // Legacy reports without these optional coordinates remain readable.
   // A verified native k target must refer to actual missed expert voxels.
   const hasPeak=c.peakMissedSliceIndexK!==undefined||
      c.peakMissedSliceVoxels!==undefined;
   if(hasPeak){
     if(c.modelMissedExpertVoxels===0){
       if(c.peakMissedSliceIndexK!==null||c.peakMissedSliceVoxels!==null)
         throw Error("Неверный срез при отсутствии пропусков.");
     }else if(!integer(c.peakMissedSliceIndexK)||
       c.peakMissedSliceIndexK>=model.source.geometry.dimensions[2]||
       !integer(c.peakMissedSliceVoxels)||c.peakMissedSliceVoxels<1||
       c.peakMissedSliceVoxels>c.modelMissedExpertVoxels)
       throw Error("Неверный k-срез пропущенного экспертного типа.");
   }
   previous=c.sourceLabel;seen.add(c.sourceLabel);
   all+=c.expertVoxels;overlap+=c.modelOverlappingExpertVoxels;
   missed+=c.modelMissedExpertVoxels;
 }
 if(all!==expected||overlap!==m.truePositiveVoxels||missed!==m.falseNegativeVoxels)
   throw Error("Покрытие классов противоречит независимым 3D TP/FN.");
 return p as IchExpertSubtypeCoverage;
}
