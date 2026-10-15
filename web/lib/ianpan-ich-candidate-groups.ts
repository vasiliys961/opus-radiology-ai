/** Spatial clustering of genuine ICH research 512x512 model proposals.
 *
 * A "candidate region" is NOT a hematoma, clinical lesion, segmentation,
 * volume measurement, true-positive or physician determination. Combines
 * duplicate "any" and subtype hits on the SAME slice before connecting
 * adjacent model-ordered slice regions. Never bridges absent model slices,
 * inference errors or non-overlapping source regions.
 */
import {ICH_CLASSES,type IchAlternativeClass,
  type IchAlternativeCandidate,type IchAlternativeReport} from "./ianpan-ich-report";

export type IchCandidateGroup={
  id:string;
  candidateClass:IchAlternativeClass;
  firstModelSliceZeroBased:number;
  lastModelSliceZeroBased:number;
  modelSlicesWithRegions:number;
  peakRawUncalibratedScore:number;
  modelInputBoundingEnvelopeXY:[number,number,number,number];
  nativeNiftiBoundingEnvelopeXYZ:[number,number,number,number,number,number]|null;
  projectionClinicallyVerified:false;
  actualLesionOrHematomaCountEstablished:false;
  hemorrhageVolumeMl:null;
};
export type IchGroupingResult={
 groups:IchCandidateGroup[];
 unlocalizedClassifierEntries:number;
 anyCategoryDuplicatesSuppressed:number;
 interpretedAsClinicalDiagnosis:false;
};
type Localized=IchAlternativeCandidate & {modelInputBoundingBoxXY:[number,number,number,number]};
const size=(b:[number,number,number,number])=>(b[2]-b[0]+1)*(b[3]-b[1]+1);
function intersectionOverSmaller(a:[number,number,number,number],b:[number,number,number,number]){
 const w=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0])+1);
 const h=Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1])+1);
 return w*h/Math.min(size(a),size(b));
}
function isLocalized(x:IchAlternativeCandidate):x is Localized{
 const b=x.modelInputBoundingBoxXY;
 return b!==null && b.every(v=>Number.isSafeInteger(v)&&v>=0&&v<512)&&
   b[0]<=b[2]&&b[1]<=b[3]&&
   x.heatmapPositivePixelsAtPoint5>0;
}
const classSort=new Map<string,number>(ICH_CLASSES.map((name,i)=>[name,i]));
export function groupIchResearchCandidateRegions(report:IchAlternativeReport):IchGroupingResult{
 if(report.readyForClinicalUse!==false||report.negativeDiagnosticConclusionAllowed!==false||
    report.modelInputHeatmapsAreSourceAligned!==false||!Array.isArray(report.candidates))
   throw Error("not_research_only_ich_report");
 const candidates=report.candidates;
 const typed=candidates.filter(c=>c.class!=="any"&&isLocalized(c)) as Localized[];
 const generic=candidates.filter(c=>c.class==="any"&&isLocalized(c)) as Localized[];
 // An 'any' score on the same slice with overlapping subtype is a SECOND
 // model channel for the same place, not an independently counted lesion.
 const unassignedAny=generic.filter(any=>!typed.some(c=>
   c.sliceIndexModelOrdered===any.sliceIndexModelOrdered&&
   intersectionOverSmaller(c.modelInputBoundingBoxXY,any.modelInputBoundingBoxXY)>=0.1
 ));
 const selected=[...typed,...unassignedAny].sort((a,b)=>
   (classSort.get(a.class)??99)-(classSort.get(b.class)??99)||
   a.sliceIndexModelOrdered-b.sliceIndexModelOrdered
 );
 type Working={class:IchAlternativeClass;children:Localized[]};
 const working:Working[]=[];
 for(const candidate of selected){
   const chosen=working.find(g=>
     g.class===candidate.class&&
     g.children[g.children.length-1].sliceIndexModelOrdered+1===candidate.sliceIndexModelOrdered&&
     intersectionOverSmaller(
       g.children[g.children.length-1].modelInputBoundingBoxXY,
       candidate.modelInputBoundingBoxXY
     )>=0.1
   );
   if(chosen)chosen.children.push(candidate);
   else working.push({class:candidate.class,children:[candidate]});
 }
 const groups=working.map(g=>{
   const first=g.children[0],last=g.children[g.children.length-1];
   const modelBounds=g.children.map(c=>c.modelInputBoundingBoxXY);
   const x0=Math.min(...modelBounds.map(b=>b[0]));
   const y0=Math.min(...modelBounds.map(b=>b[1]));
   const x1=Math.max(...modelBounds.map(b=>b[2]));
   const y1=Math.max(...modelBounds.map(b=>b[3]));
   const source=g.children.map(c=>c.sourceVoxelProjection);
   const verifiedNumericOnly=source.every(x=>x!==undefined&&x!==null&&
     x.independentlyClinicallyVerified===false&&x.expertMaskCompared===false);
   const v=verifiedNumericOnly?
     (source as Exclude<typeof source[number],undefined|null>[]).map(
       x=>x.boundingBoxNativeNiftiXYZ
     ):null;
   const nativeEnvelope=v?([
      ...[0,1,2].map(j=>Math.min(...v.map(b=>b[j]))),
      ...[3,4,5].map(j=>Math.max(...v.map(b=>b[j])))
   ] as [number,number,number,number,number,number]):null;
   return {
     id:g.class+"/"+first.sliceIndexModelOrdered+"-"+last.sliceIndexModelOrdered,
     candidateClass:g.class,
     firstModelSliceZeroBased:first.sliceIndexModelOrdered,
     lastModelSliceZeroBased:last.sliceIndexModelOrdered,
     modelSlicesWithRegions:g.children.length,
     peakRawUncalibratedScore:Math.max(...g.children.map(c=>c.rawUncalibratedScore)),
     modelInputBoundingEnvelopeXY:[x0,y0,x1,y1] as [number,number,number,number],
     nativeNiftiBoundingEnvelopeXYZ:nativeEnvelope,
     projectionClinicallyVerified:false as const,
     actualLesionOrHematomaCountEstablished:false as const,
     hemorrhageVolumeMl:null,
   };
 });
 return {
   groups,
   unlocalizedClassifierEntries:candidates.filter(c=>!isLocalized(c)).length,
   anyCategoryDuplicatesSuppressed:generic.length-unassignedAny.length,
   interpretedAsClinicalDiagnosis:false,
 };
}
