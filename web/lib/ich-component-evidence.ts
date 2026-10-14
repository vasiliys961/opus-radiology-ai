import type {IchResearchReport} from "./ich-research";
import type {IchReferenceComparison} from "./ich-reference-comparison";

export type IchMaskFragment={
 componentIndex:number;voxelCount:number;volumeMl:number;
 boundsVoxelMin:[number,number,number];boundsVoxelMax:[number,number,number];
 otherMaskComponentIndices:number[];overlapVoxels:number;
 unmatchedVoxels?:number;reviewSliceIndexK?:number;
 reviewSliceUnmatchedVoxels?:number;
 componentOverlapFraction:number;hasAnyVoxelOverlap:boolean;
 ambiguousMultiComponentContact:boolean;
};
export type IchComponentEvidence={
 schema:"opus-ich-expert-component-contact/v1";
 status:"single_authorized_mask_pair_component_overlap_not_lesion_detection_validation";
 comparisonSchema:"opus-ich-public-expert-mask-comparison/v1";
 evidenceHashes:IchReferenceComparison["evidenceHashes"];
 modelId:"samihs-ich-binary-ct";referenceLabel:number;
 sourceNativeIndexGridMatch:true;caseCount:1;clinicalValidation:false;
 componentEvidence:{
   connectivity:"6_neighbor_index_space";allComponentsCounted:true;
   reportedLargestPerMaskLimit:128;
   expertFragmentsTotal:number;predictedFragmentsTotal:number;
   expertFragmentsWithAnyVoxelOverlap:number;expertFragmentsWithZeroOverlap:number;
   predictedFragmentsWithZeroOverlap:number;
   expertFragmentsContactingMultiplePredictions:number;
   predictedFragmentsContactingMultipleExpertFragments:number;
   largestExpertFragments:IchMaskFragment[];
   largestPredictedFragments:IchMaskFragment[];
   clinicalLesionSensitivity:null;clinicalFalsePositivesPerScan:null;
   hemorrhageSubtypesDetermined:false;
 };
 limitations:string[];
};
const obj=(v:unknown):Record<string,unknown>=>{
 if(v===null||typeof v!=="object"||Array.isArray(v))throw Error("Некорректный 3D-паспорт.");
 return v as Record<string,unknown>;
};
const int=(n:unknown):n is number=>
 typeof n==="number"&&Number.isSafeInteger(n)&&n>=0;
const num=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n);
const vec=(v:unknown):number[]=>{
 if(!Array.isArray(v)||v.length!==3||!v.every(int))
   throw Error("Некорректные воксельные координаты.");
 return v;
};
function validateFragments(
 raw:unknown,total:number,otherTotal:number,dimension:number[],voxelMl:number,
 volumeVoxels:number,kind:string
):IchMaskFragment[]{
 if(!Array.isArray(raw)||raw.length!==Math.min(total,128))
   throw Error("Список "+kind+" не соответствует количеству 3D-компонент.");
 const ids=new Set<number>();let prev=Infinity,volume=0;
 const fragments:IchMaskFragment[]=[];
 for(const item of raw){
   const r=obj(item),lo=vec(r.boundsVoxelMin),hi=vec(r.boundsVoxelMax);
   const n=r.voxelCount,index=r.componentIndex,overlap=r.overlapVoxels;
   const peers=r.otherMaskComponentIndices;
   if(!int(index)||index>=total||ids.has(index)||
      !int(n)||n<1||n>prev||!int(overlap)||overlap>n||
      !num(r.volumeMl)||Math.abs(r.volumeMl-n*voxelMl)>0.0000011||
      !num(r.componentOverlapFraction)||
      Math.abs(r.componentOverlapFraction-overlap/n)>1e-9||
      r.hasAnyVoxelOverlap!==(overlap>0)||
      !Array.isArray(peers)||peers.length>otherTotal||
      peers.some(p=>!int(p)||p>=otherTotal)||
      new Set(peers).size!==peers.length||
      r.ambiguousMultiComponentContact!==(peers.length>1)||
      (peers.length===0)!==(overlap===0)||
      lo.some((v,i)=>v>hi[i]||hi[i]>=dimension[i])||
      n>lo.reduce((acc,v,i)=>acc*(hi[i]-v+1),1))
     throw Error("Несогласованная 3D-компонента "+kind+".");
   // New reports point to a slice containing the largest local mismatch;
   // old research reports without these optional fields remain importable.
   const hasAny=["unmatchedVoxels","reviewSliceIndexK","reviewSliceUnmatchedVoxels"]
     .some(key=>r[key]!==undefined);
   if(hasAny&&(
      !int(r.unmatchedVoxels)||r.unmatchedVoxels!==n-overlap||
      !int(r.reviewSliceIndexK)||
      r.reviewSliceIndexK<lo[2]||r.reviewSliceIndexK>hi[2]||
      !int(r.reviewSliceUnmatchedVoxels)||
      r.reviewSliceUnmatchedVoxels>r.unmatchedVoxels||
      (r.unmatchedVoxels>0&&r.reviewSliceUnmatchedVoxels===0)||
      (r.unmatchedVoxels===0&&r.reviewSliceUnmatchedVoxels!==0)
   ))throw Error("Срез локализации ошибки не согласован с масками.");
   ids.add(index);prev=n;volume+=n;fragments.push(r as unknown as IchMaskFragment);
 }
 if(total<=128&&volume!==volumeVoxels)
   throw Error("Сумма объёмов "+kind+" противоречит проверенной маске.");
 if(total>128&&volume>volumeVoxels)
   throw Error("Неверный частичный объём "+kind+".");
 return fragments;
}
export function parseIchComponentEvidence(
 raw:string,comparison:IchReferenceComparison,model:IchResearchReport
):IchComponentEvidence{
 if(raw.length>2*1024*1024)throw Error("Файл больше 2 МиБ.");
 const root=obj(JSON.parse(raw)),hashes=obj(root.evidenceHashes),
  c=obj(root.componentEvidence);
 if(root.schema!=="opus-ich-expert-component-contact/v1"||
    root.status!=="single_authorized_mask_pair_component_overlap_not_lesion_detection_validation"||
    root.comparisonSchema!==comparison.schema||
    root.modelId!==comparison.modelId||root.referenceLabel!==comparison.referenceLabel||
    root.sourceNativeIndexGridMatch!==true||root.caseCount!==1||
    root.clinicalValidation!==false||
    hashes.sourceSha256!==comparison.evidenceHashes.sourceSha256||
    hashes.predictionSha256!==comparison.evidenceHashes.predictionSha256||
    hashes.expertMaskSha256!==comparison.evidenceHashes.expertMaskSha256||
    c.connectivity!=="6_neighbor_index_space"||c.allComponentsCounted!==true||
    c.reportedLargestPerMaskLimit!==128||
    c.clinicalLesionSensitivity!==null||c.clinicalFalsePositivesPerScan!==null||
    c.hemorrhageSubtypesDetermined!==false||
    !Array.isArray(root.limitations)||!root.limitations.length||
    root.limitations.some(x=>typeof x!=="string"||x.length>1000))
   throw Error("3D-паспорт не относится к текущим КТ и экспертной маске.");
 const ep=c.expertFragmentsTotal,pr=c.predictedFragmentsTotal;
 const overlap=c.expertFragmentsWithAnyVoxelOverlap,miss=c.expertFragmentsWithZeroOverlap,
       extra=c.predictedFragmentsWithZeroOverlap,
       split=c.expertFragmentsContactingMultiplePredictions,
       merge=c.predictedFragmentsContactingMultipleExpertFragments;
 if(!int(ep)||!int(pr)||ep>4096||pr>4096||
   !int(overlap)||!int(miss)||overlap+miss!==ep||
   !int(extra)||extra>pr||!int(split)||split>overlap||
   !int(merge)||merge>pr-extra)
   throw Error("Несогласованное количество 3D-компонент.");
 const tp=comparison.metrics.truePositiveVoxels,
  predTotal=tp+comparison.metrics.falsePositiveVoxels,
  expertTotal=tp+comparison.metrics.falseNegativeVoxels;
 const dimensions=model.source.geometry.dimensions;
 const voxelMl=model.source.geometry.voxelVolumeMl;
 const experts=validateFragments(c.largestExpertFragments,ep,pr,dimensions,voxelMl,expertTotal,"эксперта");
 const predicts=validateFragments(c.largestPredictedFragments,pr,ep,dimensions,voxelMl,predTotal,"SAMIHS");
 if(ep<=128&&pr<=128){
   const es=new Map(experts.map(x=>[x.componentIndex,x]));
   const ps=new Map(predicts.map(x=>[x.componentIndex,x]));
   const eOverlap=experts.reduce((sum,x)=>sum+x.overlapVoxels,0);
   const pOverlap=predicts.reduce((sum,x)=>sum+x.overlapVoxels,0);
   if(eOverlap!==tp||pOverlap!==tp||
      experts.filter(x=>x.hasAnyVoxelOverlap).length!==overlap||
      predicts.filter(x=>!x.hasAnyVoxelOverlap).length!==extra||
      experts.filter(x=>x.ambiguousMultiComponentContact).length!==split||
      predicts.filter(x=>x.ambiguousMultiComponentContact).length!==merge||
      experts.some(x=>x.otherMaskComponentIndices.some(i=>
        !ps.get(i)?.otherMaskComponentIndices.includes(x.componentIndex)))||
      predicts.some(x=>x.otherMaskComponentIndices.some(i=>
        !es.get(i)?.otherMaskComponentIndices.includes(x.componentIndex))))
     throw Error("Контакты компонент противоречат 3D Dice и исходным маскам.");
 }
 return root as IchComponentEvidence;
}
