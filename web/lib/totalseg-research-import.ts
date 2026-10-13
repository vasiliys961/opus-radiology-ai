/** Research-only TotalSegmentator five-lobe manifest bound to exact mask bytes.
 * This does not authenticate a patient's DICOM identity or the model vendor.
 */
import type {LabelMask} from "./segmentation-mask.ts";

export const LOBE_NAMES:Readonly<Record<number,string>>=Object.freeze({
  10:"Левое лёгкое · верхняя доля",
  11:"Левое лёгкое · нижняя доля",
  12:"Правое лёгкое · верхняя доля",
  13:"Правое лёгкое · средняя доля",
  14:"Правое лёгкое · нижняя доля",
});
export type ResearchLobes={
  sourceSha256:string; maskSha256:string; firstSlice:number; lastSlice:number;
  fullDimensions:number[]; labelNames:Readonly<Record<number,string>>;
  missingLabels:number[]; status:"not_validated";
};
const digest=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{64}$/.test(v);
const record=(v:unknown):Record<string,unknown>=>{
  if(!v||typeof v!=="object"||Array.isArray(v))throw Error("Некорректный исследовательский паспорт.");
  return v as Record<string,unknown>;
};
export function parseResearchLobes(json:string,mask:LabelMask,actualSha:string):ResearchLobes{
  if(new TextEncoder().encode(json).length>65536)throw Error("Паспорт превышает 64 КиБ.");
  let decoded:unknown;
  try{decoded=JSON.parse(json);}catch{throw Error("Неверный JSON исследовательской маски.");}
  const m=record(decoded);
  if(m.schema!=="opus-totalseg-native-mpr-slab/v1"||
     m.sourceGridGeometry!=="native_contiguous_unresampled"||
     m.clinicalStatus!=="not_validated"||m.readyForClinicalUse!==false||
     m.fullAnatomicCoverageVerified!==false)
    throw Error("Несовместимый тип или клинический статус паспорта.");
  if(!digest(actualSha)||!digest(m.slabMaskSha256)||m.slabMaskSha256!==actualSha||
     !digest(m.sourceFullCtSha256)||!digest(m.sourceFullMaskSha256))
    throw Error("Контрольная сумма маски не совпадает с паспортом.");
  const shapes=[m.sourceDimensions,m.slabDimensions];
  if(shapes.some(s=>!Array.isArray(s)||s.length!==3||
       !s.every((v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=1&&Number(v)<=32767)))
    throw Error("Некорректная размерность маски.");
  const full=m.sourceDimensions as number[], slab=m.slabDimensions as number[];
  if(slab.some((n,i)=>n!==mask.dimensions[i])||full[0]!==slab[0]||full[1]!==slab[1])
    throw Error("Размерности исследования и маски не совпадают.");
  const first=m.firstOriginalSliceIndexZeroBased,last=m.lastOriginalSliceIndexZeroBased;
  if(typeof first!=="number"||!Number.isSafeInteger(first)||first<0||
     typeof last!=="number"||!Number.isSafeInteger(last)||last-first+1!==slab[2]||last>=full[2])
    throw Error("Диапазон срезов не соответствует исходной КТ.");
  const rows=m.labelVoxels;
  if(!Array.isArray(rows)||rows.length!==5)
    throw Error("Нужны пять проверяемых анатомических меток.");
  const expected=[10,11,12,13,14], actual=new Map(mask.labels.map(l=>[l.id,l.voxels]));
  if([...actual.keys()].some(id=>!expected.includes(id)))throw Error("Неизвестная метка маски.");
  const missing:number[]=[];
  for(let i=0;i<5;i++){
    const row=record(rows[i]),id=expected[i],voxels=row.voxels;
    if(row.id!==id||typeof voxels!=="number"||!Number.isSafeInteger(voxels)||
       voxels<0||voxels!==(actual.get(id)??0))
      throw Error("Число вокселей или метка отличается от паспорта.");
    if(voxels===0)missing.push(id);
  }
  if(missing.length===5)throw Error("Пустая маска не означает отсутствие изменений.");
  return {sourceSha256:m.sourceFullCtSha256 as string,maskSha256:actualSha,
    firstSlice:first,lastSlice:last,fullDimensions:[...full],
    labelNames:LOBE_NAMES,missingLabels:missing,status:"not_validated"};
}
