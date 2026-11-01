import {strict as assert} from "node:assert";
import {suggestPrimaryDicomSeries,canAutoPrepareLocalVision} from "./automatic-primary-series.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";

// Realistic numeric DICOM identifiers and affine geometry are required by
// the shared frame planner, not merely truthy UID placeholders.
const uid=(value:string)=>"1.2.826.0.1.3680043.10.543."+
 String([...value].reduce((n,c)=>(n*37+c.charCodeAt(0))%1000000000,7));
const series=(key:string,modality:string,region:TechnicalDicomMetadata["bodyRegion"],
 count:number,ready:boolean,role:TechnicalDicomMetadata["imageRole"]="PRIMARY",
 study="public-study"):DicomSeries=>({
 key,label:key,modality,volumeReady:ready,spatiallySorted:ready,
 sliceSpacingMm:ready?1:null,warning:null,
 members:Array.from({length:count},(_,i)=>({
  id:`${key}-${i}`,name:`img-${i}.dcm`,
  metadata:{
   modality,bodyRegion:region,imageRole:role,numberOfFrames:1,
   studyUid:uid(study),seriesUid:uid(key),sopInstanceUid:`${uid(key)}.${i+1}`,
   frameOfReferenceUid:uid("public-frame"),
   imagePositionPatient:[0,0,i],imageOrientationPatient:[1,0,0,0,1,0],
  } as TechnicalDicomMetadata,
 })),
});
const select=(items:DicomSeries[])=>suggestPrimaryDicomSeries(items,
 new Set(items.flatMap(s=>s.members.map(m=>m.id))));
assert.equal(select([]).key,null);
const scout=series("scout","CT","CHEST",1,false,"LOCALIZER");
const chest=series("diagnostic-chest","CT","CHEST",103,true);
assert.deepEqual([select([scout,chest]).key,select([scout,chest]).runnable],
 ["diagnostic-chest",true],"Original diagnostic volume must beat localizer");
const derived=series("reconstruction","CT","CHEST",220,true,"DERIVED");
assert.equal(select([derived,chest]).key,chest.key,"Never prefer derived CT over original");
const unknown=series("unknown-anatomy","CT",null,256,true);
assert.equal(select([unknown,chest]).key,chest.key,"Unknown anatomy cannot be silently declared chest");
const onlyUnknown=select([scout,unknown]);
assert.equal(onlyUnknown.key,unknown.key);
assert.equal(onlyUnknown.runnable,false,"Unknown anatomy cannot trigger native inference");
const other=series("abdomen","CT","ABDOMEN",120,true);
const multiple=select([chest,other]);
assert.equal(multiple.ambiguity,true,"Competing diagnostic series must be disclosed");
assert.equal(multiple.key,other.key,"Choose larger complete native volume when multiple are eligible");
const incomplete=new Set(chest.members.slice(1).map(m=>m.id));
assert.equal(suggestPrimaryDicomSeries([chest,scout],incomplete).runnable,false,
 "Missing original pixels must never be called runnable");
assert.equal(canAutoPrepareLocalVision(chest),true,
 "Original CT can prepare local PNG samples without cloud permission");
assert.equal(canAutoPrepareLocalVision(series("brain","MR","HEAD",28,true)),true);
assert.equal(canAutoPrepareLocalVision(scout),false);
assert.equal(canAutoPrepareLocalVision(derived),false);
assert.equal(canAutoPrepareLocalVision(series("broken","MR","HEAD",30,false)),false);
assert.equal(canAutoPrepareLocalVision(series("xray","DX","CHEST",1,false)),false);
assert.equal(canAutoPrepareLocalVision({...chest,members:chest.members.map((m,i)=>i===0?
 {...m,metadata:{...m.metadata,studyUid:null}}:m)}),false);
assert.equal(canAutoPrepareLocalVision({...chest,members:chest.members.map((m,i)=>i===1?
 {...m,metadata:{...m.metadata,seriesUid:uid("other-series")}}:m)}),false,
 "Mixed SeriesInstanceUID must not auto-open Vision");
assert.equal(canAutoPrepareLocalVision({...chest,members:chest.members.map((m,i)=>i===1?
 {...m,metadata:{...m.metadata,sopInstanceUid:chest.members[0].metadata.sopInstanceUid}}:m)}),false,
 "Duplicate SOPInstanceUID must not auto-open Vision");
assert.equal(canAutoPrepareLocalVision({...chest,members:chest.members.map((m,i)=>i===1?
 {...m,metadata:{...m.metadata,imageOrientationPatient:null}}:m)}),false,
 "Missing physical affine must not auto-open Vision");
console.log("PASS automatic native DICOM primary series selection and fail-closed routes");
