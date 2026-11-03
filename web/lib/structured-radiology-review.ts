/** Observational data only. No diagnosis, guessed measurements or confidence-as-probability. */
export type StructureReview={imageIds:string[];anatomy:string;visibility:'visible'|'partial'|'not_assessed';description:string;importantNegatives:string[];limitations:string};
export type ImageQualityReview={imageId:string;quality:'diagnostic'|'limited'|'non_diagnostic';limitations:string};
export type StructuredRadiologyReview={structures:StructureReview[];imageQuality:ImageQualityReview[]};
export type SourceRadiologyReview={structures:Array<Omit<StructureReview,'imageIds'>&{sliceNumbers:number[]}>;imageQuality:Array<Omit<ImageQualityReview,'imageId'>&{sliceNumber:number}>};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export function parseStructuredRadiologyReview(raw:unknown,ids:readonly string[]):StructuredRadiologyReview{
 if(!obj(raw)||Object.keys(raw).sort().join(',')!=='imageQuality,structures'||!Array.isArray(raw.structures)||!raw.structures.length||raw.structures.length>8||!Array.isArray(raw.imageQuality)||raw.imageQuality.length!==ids.length)throw Error('Missing bounded structure/quality review');
 const q=raw.imageQuality,structures=raw.structures;
 if(new Set(q.map(x=>x?.imageId)).size!==ids.length||q.some(x=>!obj(x)||Object.keys(x).sort().join(',')!=='imageId,limitations,quality'||!ids.includes(x.imageId as string)||!['diagnostic','limited','non_diagnostic'].includes(x.quality as string)||!text(x.limitations,200)))throw Error('Unbound image quality');
 for(const s of structures){
  if(!obj(s)||Object.keys(s).sort().join(',')!=='anatomy,description,imageIds,importantNegatives,limitations,visibility'||!Array.isArray(s.imageIds)||!s.imageIds.length||s.imageIds.length>ids.length||new Set(s.imageIds).size!==s.imageIds.length||s.imageIds.some(id=>!ids.includes(id))||!text(s.anatomy,180)||!['visible','partial','not_assessed'].includes(s.visibility as string)||!text(s.description,300)||!text(s.limitations,200)||!Array.isArray(s.importantNegatives)||s.importantNegatives.length>3||s.importantNegatives.some(v=>!text(v,180)))throw Error('Invalid source-bound organ description');
  if(s.importantNegatives.length&&(s.visibility==='not_assessed'||s.imageIds.some(id=>q.some(x=>x.imageId===id&&x.quality==='non_diagnostic'))))throw Error('Unsupported negative from unassessed or nondiagnostic images');
 }
 if(ids.some(id=>!structures.some(s=>s.imageIds.includes(id))))throw Error('Structure coverage omitted a reviewed image');
 return raw as unknown as StructuredRadiologyReview;
}
export function bindStructuredRadiologyReview(raw:StructuredRadiologyReview,indices:readonly number[]):SourceRadiologyReview{
 const ids=indices.map((_,i)=>'frame-'+(i+1));const review=parseStructuredRadiologyReview(raw,ids);
 return {structures:review.structures.map(({imageIds,...s})=>({...s,sliceNumbers:imageIds.map(id=>indices[ids.indexOf(id)]+1)})),imageQuality:review.imageQuality.map(({imageId,...q})=>({...q,sliceNumber:indices[ids.indexOf(imageId)]+1}))};
}
export function validSourceRadiologyReview(raw:unknown,allowed:readonly number[]):raw is SourceRadiologyReview{
 try{
  if(!obj(raw)||Object.keys(raw).sort().join(',')!=='imageQuality,structures'||!Array.isArray(raw.imageQuality)||!raw.imageQuality.length||raw.imageQuality.length>4||!Array.isArray(raw.structures))return false;
  const ns=raw.imageQuality.map(q=>q?.sliceNumber);
  if(ns.some(n=>!Number.isSafeInteger(n)||!allowed.includes(n))||new Set(ns).size!==ns.length)return false;
  const ids=ns.map((_,i)=>'frame-'+(i+1));
  parseStructuredRadiologyReview({imageQuality:raw.imageQuality.map(({sliceNumber,...q})=>({...q,imageId:ids[ns.indexOf(sliceNumber)]})),structures:raw.structures.map(s=>{
   if(!obj(s)||!Array.isArray(s.sliceNumbers)||s.sliceNumbers.some(n=>!ns.includes(n)))throw Error('Wrong original slice');
   const {sliceNumbers,...rest}=s;return {...rest,imageIds:sliceNumbers.map(n=>ids[ns.indexOf(n)])};
  })},ids);return true;
 }catch{return false;}
}
export function structuredRadiologyFormat(ids:readonly string[]){
 const str=(maxLength:number)=>({type:'string',maxLength});
 return {type:'object',additionalProperties:false,properties:{structures:{type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,properties:{imageIds:{type:'array',minItems:1,maxItems:ids.length,items:{type:'string',enum:[...ids]}},anatomy:str(180),visibility:{type:'string',enum:['visible','partial','not_assessed']},description:str(300),importantNegatives:{type:'array',maxItems:3,items:str(180)},limitations:str(200)},required:['imageIds','anatomy','visibility','description','importantNegatives','limitations']}},imageQuality:{type:'array',minItems:ids.length,maxItems:ids.length,items:{type:'object',additionalProperties:false,properties:{imageId:{type:'string',enum:[...ids]},quality:{type:'string',enum:['diagnostic','limited','non_diagnostic']},limitations:str(200)},required:['imageId','quality','limitations']}}},required:['structures','imageQuality']};
}
