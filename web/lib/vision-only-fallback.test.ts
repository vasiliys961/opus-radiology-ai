import {strict as assert} from "node:assert";
import {eligibleVisionOnlyFallback} from "./vision-only-fallback.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";
import {planNativeStudyAnalysis} from "./unified-study-dispatch.ts";

const series=(modality:"CT"|"MR",region:TechnicalDicomMetadata["bodyRegion"]):DicomSeries=>({
 key:"study-series",label:"original",modality,volumeReady:true,spatiallySorted:true,
 sliceSpacingMm:1,warning:null,members:Array.from({length:20},(_,i)=>({
 id:"image-"+i,name:"frame-"+i+".dcm",metadata:{
  modality,bodyRegion:region,imageRole:"PRIMARY",studyUid:"1.2.3.4",
  seriesUid:"1.2.3.4.5",sopInstanceUid:"1.2.3.4.5."+String(i+1),
  frameOfReferenceUid:"1.2.3.4.6",numberOfFrames:1,
  imagePositionPatient:[0,0,i],imageOrientationPatient:[1,0,0,0,1,0],
 } as TechnicalDicomMetadata,
 })),
});
const present=(s:DicomSeries)=>new Set(s.members.map(m=>m.id));
for(const s of [series("CT","PELVIS"),series("MR","SPINE")]){
 assert.equal(planNativeStudyAnalysis(s,present(s)).route,null);
 assert.equal(eligibleVisionOnlyFallback(s,present(s)),true,
   "An original, geometrically verified unsupported study should still reach local Vision");
}
const s=series("CT","PELVIS");
assert.equal(eligibleVisionOnlyFallback(s,new Set(["image-0"])),false);
assert.equal(eligibleVisionOnlyFallback({...s,volumeReady:false},present(s)),false);
assert.equal(eligibleVisionOnlyFallback({...s,members:s.members.map((m,i)=>i===0?
 {...m,metadata:{...m.metadata,studyUid:null}}:m)},present(s)),false);
assert.equal(eligibleVisionOnlyFallback({...s,members:s.members.map((m,i)=>i===0?
 {...m,metadata:{...m.metadata,imageRole:"DERIVED" as const}}:m)},present(s)),false);
assert.equal(eligibleVisionOnlyFallback({...s,members:s.members.map((m,i)=>i===0?
 {...m,metadata:{...m.metadata,imageRole:"LOCALIZER" as const}}:m)},present(s)),false);
console.log("PASS independent Vision-only fallback for source verified unmatched CT/MR");
