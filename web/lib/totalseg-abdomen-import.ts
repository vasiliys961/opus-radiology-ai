/** Research-only source-bound TotalSegmentator abdominal-organ masks.
 * An unsigned manifest is an integrity aid, never model, patient or DICOM proof.
 */
import type {LabelMask} from "./segmentation-mask.ts";
import {parseResearchLobes,type ResearchLobes} from "./totalseg-research-import.ts";

export const ABDOMEN_NAMES:Readonly<Record<number,string>>=Object.freeze({
  1:"Селезёнка",
  2:"Правая почка",
  3:"Левая почка",
  5:"Печень",
});
export type AnatomyProof=ResearchLobes & {anatomy:"lung"|"abdomen"};
const IDS=[1,2,3,5] as const;
const sha=(x:unknown):x is string=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
const row=(x:unknown):Record<string,unknown>=>{
  if(x===null||typeof x!=="object"||Array.isArray(x))
    throw Error("Паспорт исследовательской маски имеет неверный формат.");
  return x as Record<string,unknown>;
};
const dimensions=(x:unknown):x is [number,number,number]=>Array.isArray(x)&&x.length===3&&
  x.every(n=>typeof n==="number"&&Number.isSafeInteger(n)&&n>0&&n<=32767);

export function parseResearchAbdomen(json:string,mask:LabelMask,actualSha:string):AnatomyProof {
  if(typeof json!=="string"||new TextEncoder().encode(json).byteLength>65536)
    throw Error("Паспорт превышает 64 КиБ.");
  let data:Record<string,unknown>;
  try{data=row(JSON.parse(json));}catch{throw Error("Некорректный JSON паспорта.");}
  if(data.schema!=="opus-totalseg-abdomen-native-mpr-slab/v1"||
      data.researchProfile!=="abdomen-four-organs"||
      data.sourceGridGeometry!=="native_contiguous_unresampled"||
      data.readyForClinicalUse!==false||
      data.fullAnatomicCoverageVerified!==false||
      data.clinicalStatus!=="not_validated")
    throw Error("Паспорт не относится к исследовательским органам живота.");
  if(!sha(actualSha)||!sha(data.sourceFullCtSha256)||
      !sha(data.sourceFullMaskSha256)||!sha(data.slabMaskSha256)||
      actualSha!==data.slabMaskSha256)
    throw Error("Контрольная сумма маски не соответствует паспорту.");
  if(!dimensions(data.sourceDimensions)||!dimensions(data.slabDimensions))
    throw Error("Некорректный размер исходной КТ или маски.");
  const full=data.sourceDimensions,slab=data.slabDimensions;
  if(slab.some((n,i)=>n!==mask.dimensions[i])||full[0]!==slab[0]||full[1]!==slab[1]||
     full.some((n,i)=>n>(i===2?300:512))||slab.reduce((a,b)=>a*b,1)>8_388_608)
    throw Error("Паспорт не совпадает с ограниченной сеткой маски.");
  const start=data.firstOriginalSliceIndexZeroBased,end=data.lastOriginalSliceIndexZeroBased;
  if(typeof start!=="number"||!Number.isSafeInteger(start)||start<0||
     typeof end!=="number"||!Number.isSafeInteger(end)||
     end-start+1!==slab[2]||end>=full[2])
    throw Error("Исходный диапазон срезов не совпадает с маской.");
  if(!Array.isArray(data.labelVoxels)||data.labelVoxels.length!==IDS.length)
    throw Error("Паспорт должен содержать четыре анатомические метки.");
  const actual=new Map(mask.labels.map(l=>[l.id,l.voxels]));
  if([...actual.keys()].some(id=>!IDS.includes(id as typeof IDS[number])))
    throw Error("В маске обнаружена неизвестная анатомическая метка.");
  const missing:number[]=[];
  for(let i=0;i<IDS.length;i++){
    const label=row(data.labelVoxels[i]),id=IDS[i],voxels=label.voxels;
    if(label.id!==id||typeof voxels!=="number"||!Number.isSafeInteger(voxels)||
       voxels<0||voxels!==(actual.get(id)??0))
      throw Error("Неверное количество вокселей или порядок меток органов.");
    if(voxels===0)missing.push(id);
  }
  if(missing.length===IDS.length)throw Error("Пустая маска не означает норму.");
  if(!Number.isFinite(mask.voxelVolumeMm3)||mask.voxelVolumeMm3<=0)
    throw Error("Неверные пространственные единицы маски.");
  return {
    sourceSha256:data.sourceFullCtSha256,
    maskSha256:actualSha,
    firstSlice:start,lastSlice:end,fullDimensions:[...full],
    labelNames:ABDOMEN_NAMES,missingLabels:missing,status:"not_validated",
    anatomy:"abdomen",
  };
}

/** Existing lung passport is preserved; unknown schema is strictly rejected. */
export function parseResearchAnatomy(json:string,mask:LabelMask,actualSha:string):AnatomyProof {
  if(typeof json!=="string"||new TextEncoder().encode(json).byteLength>65536)
    throw Error("Паспорт превышает 64 КиБ.");
  let data:Record<string,unknown>;
  try{data=row(JSON.parse(json));}catch{throw Error("Некорректный JSON паспорта.");}
  if(data.schema==="opus-totalseg-native-mpr-slab/v1")
    return {...parseResearchLobes(json,mask,actualSha),anatomy:"lung"};
  if(data.schema==="opus-totalseg-abdomen-native-mpr-slab/v1")
    return parseResearchAbdomen(json,mask,actualSha);
  throw Error("Неизвестный тип исследовательской маски TotalSegmentator.");
}
