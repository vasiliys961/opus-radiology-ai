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
assert.equal(plan(make("CT","ABDOMEN",24)).route,"totalseg-abdomen");
const uncodedChest={...chest,members:chest.members.map(m=>({...m,
 metadata:{...m.metadata,bodyRegion:null,imageRole:"DERIVED" as const}}))};
assert.equal(plan(uncodedChest).route,null,"Never infer absent anatomy or derived series automatically");
assert.equal(planNativeStudyAnalysis(uncodedChest,new Set(uncodedChest.members.map(m=>m.id)),
 {clinicianConfirmedChest:true}).route,"monai-nodules");
const mixedUnknown={...uncodedChest,members:uncodedChest.members.map((m,i)=>
 i===0?{...m,metadata:{...m.metadata,bodyRegion:"ABDOMEN" as const}}:m)};
assert.equal(planNativeStudyAnalysis(mixedUnknown,new Set(mixedUnknown.members.map(m=>m.id)),
 {clinicianConfirmedChest:true}).route,null,"Never override conflicting known anatomy");
const missingSource={...uncodedChest,members:uncodedChest.members.map((m,i)=>
 i===0?{...m,metadata:{...m.metadata,sopInstanceUid:null}}:m)};
assert.equal(planNativeStudyAnalysis(missingSource,new Set(missingSource.members.map(m=>m.id)),
 {clinicianConfirmedChest:true}).route,null,"Anatomy approval cannot bypass source UID proof");
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
const cxr=make("CT","CHEST",1);
const realCxr={...cxr,modality:"DX",volumeReady:false,spatiallySorted:false,
 members:cxr.members.map(m=>({...m,metadata:{...m.metadata,
  modality:"DX",rows:1024,columns:1024,numberOfFrames:1}}))};
assert.equal(plan(realCxr).route,"xrv-cxr");
assert.equal(plan({...realCxr,modality:"CR",members:realCxr.members.map(m=>({
 ...m,metadata:{...m.metadata,modality:"CR"}}))}).route,"xrv-cxr");
assert.equal(plan({...realCxr,members:[...realCxr.members,...realCxr.members]}).route,null);
assert.equal(plan({...realCxr,members:realCxr.members.map(m=>({
 ...m,metadata:{...m.metadata,bodyRegion:"HEAD"}}))}).route,null);
assert.equal(plan({...realCxr,members:realCxr.members.map(m=>({
 ...m,metadata:{...m.metadata,imageRole:"DERIVED"}}))}).route,null);
assert.equal(plan({...realCxr,members:realCxr.members.map(m=>({
 ...m,metadata:{...m.metadata,numberOfFrames:2}}))}).route,null);
assert.equal(plan({...realCxr,members:realCxr.members.map(m=>({
 ...m,metadata:{...m.metadata,rows:null}}))}).route,null);
console.log("PASS CT/MR and real original 2-D CR/DX routing without pretending CXR is 3-D");
