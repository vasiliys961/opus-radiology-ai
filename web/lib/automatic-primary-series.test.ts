import {strict as assert} from "node:assert";
import {suggestPrimaryDicomSeries} from "./automatic-primary-series.ts";
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";

const series=(key:string,modality:string,region:TechnicalDicomMetadata["bodyRegion"],
 count:number,ready:boolean,role:TechnicalDicomMetadata["imageRole"]="PRIMARY",
 study="public-study"):DicomSeries=>({
 key,label:key,modality,volumeReady:ready,spatiallySorted:ready,
 sliceSpacingMm:ready?1:null,warning:null,
 members:Array.from({length:count},(_,i)=>({
  id:`${key}-${i}`,name:`img-${i}.dcm`,
  metadata:{
   modality,bodyRegion:region,imageRole:role,numberOfFrames:1,
   studyUid:study,seriesUid:key,sopInstanceUid:`${key}.${i}`,
   frameOfReferenceUid:"public-frame",
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
console.log("PASS automatic native DICOM primary series selection and fail-closed routes");
