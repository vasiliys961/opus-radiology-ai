import {strict as assert} from "node:assert";
import {planNativeStudyAnalysis} from "./unified-study-dispatch.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";

const make=(modality:"CT"|"MR",region:"HEAD"|"CHEST"|"ABDOMEN",count:number):DicomSeries=>({
 key:"series",label:"public DICOM",modality,spatiallySorted:true,volumeReady:true,
 sliceSpacingMm:1,warning:null,
 members:Array.from({length:count},(_,i)=>({
   id:"file-"+i,name:"slice-"+i+".dcm",
   metadata:{
     modality,bodyRegion:region,studyUid:"1.2.3",seriesUid:"1.2.3.4",
     sopInstanceUid:"1.2.3.4."+i,imageRole:"PRIMARY",numberOfFrames:1,
   } as TechnicalDicomMetadata,
 })),
});
const plan=(s:DicomSeries)=>planNativeStudyAnalysis(s,new Set(s.members.map(m=>m.id)));
const chest=make("CT","CHEST",24);
assert.equal(plan(chest).route,"monai-nodules");
const head=make("CT","HEAD",16);
assert.equal(plan(head).route,"ianpan-ich");
assert.equal(plan(make("CT","HEAD",7)).route,null);
assert.equal(plan(make("CT","HEAD",65)).route,null);
const mr=make("MR","HEAD",24);
assert.equal(plan(mr).route,"wmh-flair");
assert.equal(plan(mr).needsExplicitFlair,true);
assert.equal(plan(make("MR","ABDOMEN",24)).route,null);
assert.equal(plan(make("CT","ABDOMEN",24)).route,null);
assert.equal(plan({...chest,volumeReady:false}).route,null);
assert.equal(plan({...chest,spatiallySorted:false}).route,null);
assert.equal(planNativeStudyAnalysis(chest,new Set(["file-0"])).route,null);
assert.equal(plan({...chest,members:chest.members.map((m,i)=>i===1?{
 ...m,metadata:{...m.metadata,seriesUid:"other"}}:m)}).route,null);
assert.equal(plan({...mr,members:mr.members.map((m,i)=>i===1?{
 ...m,metadata:{...m.metadata,bodyRegion:null}}:m)}).route,null);
assert.equal(plan({...head,members:head.members.map((m,i)=>i===1?{
 ...m,metadata:{...m.metadata,imageRole:"DERIVED"}}:m)}).route,null);
assert.equal(plan({...head,members:head.members.map((m,i)=>i===1?{
 ...m,metadata:{...m.metadata,sopInstanceUid:null}}:m)}).route,null);
assert.equal(plan({...mr,members:mr.members.map((m,i)=>i===1?{
 ...m,metadata:{...m.metadata,numberOfFrames:12}}:m)}).route,null);
console.log("PASS CT chest/CT head/MR head unified routing, FLAIR consent and source gates");
