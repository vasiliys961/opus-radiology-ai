/** One source-bound study -> finite, PHI-free numeric model evidence for
 * real Gemini (text-only interpretation) followed by Claude Opus (draft).
 * This sends NO DICOM pixels, SOP/Series UID, filenames, source SHA or locations.
 * It is not Gemini VISION; visual frame review remains separately authorized.
 */
import type {BoundNoduleReport} from "./live-nodule-report.ts";
import type {ClnReport} from "./cln-native-worker.ts";
import type {OriginalEffusionRun} from "./real-effusion-worker.ts";
import type {PeCtpSourceReport} from "./pe-ctpa-direct-worker.ts";
import type {MediastinalNodeReport} from "./mediastinal-raidionics-worker.ts";
import type {AbdominalStudyResults} from "./real-abdominal-worker.ts";
import type {EvidenceJson} from "./evidence-json.ts";
import type {BoundWmh} from "./wmh-source-review.ts";
import type {BrainModelReport} from "./brain-multisequence-original-worker.ts";

export type ConsiliumTask=
  "lung_nodules"|"lung_tumor"|"pleural_effusion"|"pericardial_effusion"|
  "pulmonary_embolism"|"mediastinal_nodes"|
  "renal_cysts"|"hepatic_lesions"|"pancreatic_tumor"|
  "brain_hemorrhage"|"white_matter_hyperintensities"|
  "ischemic_stroke"|"glioma";
export type ConsiliumRegion="chest"|"abdomen"|"brain";
export type SanitizedDetectorFact={
 task:ConsiliumTask;
 status:"completed"|"not_assessed";
 candidateCount:number|null;
 candidateVolumeMl:number|null;
};
export type SanitizedDetectorBundle={
 schema:"opus-sanitized-detector-consilium/v1";
 modality:"CT"|"MR";
 region:ConsiliumRegion;
 facts:SanitizedDetectorFact[];
 sourceIdentifiersSent:false;
 sourcePixelsSent:false;
 clinicalValidation:false;
 negativeDiagnosisPermitted:false;
};
export const TASKS_BY_REGION:Record<ConsiliumRegion,readonly ConsiliumTask[]>={
 chest:["lung_nodules","lung_tumor","pleural_effusion","pericardial_effusion",
        "pulmonary_embolism","mediastinal_nodes"],
 abdomen:["renal_cysts","hepatic_lesions","pancreatic_tumor"],
 brain:["brain_hemorrhage","white_matter_hyperintensities","ischemic_stroke","glioma"],
};
const finiteCount=(n:number):number=>{
 if(!Number.isSafeInteger(n)||n<0||n>100000)throw Error("Некорректное число кандидатов.");
 return n;
};
const finiteVolume=(n:number):number=>{
 if(!Number.isFinite(n)||n<0||n>100000)
  throw Error("Некорректный объём модельных кандидатов.");
 return Math.round(n*1000)/1000;
};
export function validateSanitizedDetectorBundle(value:unknown):value is SanitizedDetectorBundle{
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const x=value as Record<string,unknown>;
 if(Object.keys(x).sort().join(",")!==
    ["schema","modality","region","facts","sourceIdentifiersSent","sourcePixelsSent",
     "clinicalValidation","negativeDiagnosisPermitted"].sort().join(",")||
    x.schema!=="opus-sanitized-detector-consilium/v1"||
    x.sourceIdentifiersSent!==false||x.sourcePixelsSent!==false||
    x.clinicalValidation!==false||x.negativeDiagnosisPermitted!==false||
    (x.modality!=="CT"&&x.modality!=="MR")||
    !["chest","abdomen","brain"].includes(String(x.region))||
    (x.region!=="brain"&&x.modality!=="CT")||
    !Array.isArray(x.facts))return false;
 const tasks=TASKS_BY_REGION[x.region as ConsiliumRegion];
 if(x.facts.length!==tasks.length)return false;
 return x.facts.every((fact:unknown,index:number)=>{
  if(!fact||typeof fact!=="object"||Array.isArray(fact))return false;
  const f=fact as Record<string,unknown>;
  if(Object.keys(f).sort().join(",")!==
      ["task","status","candidateCount","candidateVolumeMl"].sort().join(",")||
     f.task!==tasks[index]||!["completed","not_assessed"].includes(String(f.status)))
    return false;
  if(f.status==="not_assessed")return f.candidateCount===null&&f.candidateVolumeMl===null;
  return Number.isSafeInteger(f.candidateCount)&&
   Number(f.candidateCount)>=0&&Number(f.candidateCount)<=100000&&
   (f.candidateVolumeMl===null||
    (typeof f.candidateVolumeMl==="number"&&
      Number.isFinite(f.candidateVolumeMl)&&
      f.candidateVolumeMl>=0&&f.candidateVolumeMl<=100000));
 });
}
export type DetectorRuntimeSnapshot={
 modality:"CT"|"MR";
 region:ConsiliumRegion;
 nativeSourceSha256?:string|null;
 nodules?:BoundNoduleReport|null;
 cln?:ClnReport|null;
 effusion?:OriginalEffusionRun|null;
 pe?:PeCtpSourceReport|null;
 nodes?:MediastinalNodeReport|null;
 abdomen?:AbdominalStudyResults|null;
 ich?:EvidenceJson|null;
 wmh?:BoundWmh|null;
 brain?:BrainModelReport|null;
};
export function assembleSanitizedDetectorBundle(snapshot:DetectorRuntimeSnapshot):SanitizedDetectorBundle{
 const {modality,region}=snapshot;
 if((region!=="brain"&&modality!=="CT")||(modality!=="CT"&&modality!=="MR"))
  throw Error("Недопустимый тип исследования для консилиума.");
 const factMap=new Map<ConsiliumTask,SanitizedDetectorFact>();
 const complete=(task:ConsiliumTask,count:number,volume:number|null)=>{
  if(factMap.has(task))throw Error("Дублирование патологической задачи "+task);
  factMap.set(task,{task,status:"completed",candidateCount:finiteCount(count),
   candidateVolumeMl:volume===null?null:finiteVolume(volume)});
 };
 const source=snapshot.nativeSourceSha256;
 const same=(actual:string)=>{
  if(!source||!/^[a-f0-9]{64}$/.test(source)||actual!==source)
    throw Error("Модели относятся к разным исходным КТ.");
 };
 if(region==="chest"){
  if(snapshot.nodules){
   same(snapshot.nodules.source.sha256);
   complete("lung_nodules",snapshot.nodules.candidates.length,null);
  }
  if(snapshot.cln){
   same(snapshot.cln.sourceNiftiSha256);
   if(snapshot.cln.realOriginalModelForwardCompleted!==true||
      snapshot.cln.schema!=="opus-original-cln-upload-result/v1"||
      snapshot.cln.researchOnly!==true||snapshot.cln.clinicalValidation!==false||
      snapshot.cln.negativeDiagnosisPermitted!==false||
      snapshot.cln.candidateCount!==snapshot.cln.nativeCandidates.length)
     throw Error("CLN original forward is not verified");
   complete("lung_tumor",snapshot.cln.candidateCount,
     snapshot.cln.nativeCandidates.reduce((a,x)=>a+x.candidateVolumeMl,0));
  }
  if(snapshot.effusion){
   same(snapshot.effusion.report.evidence.originalChestCtSha256);
   if(snapshot.effusion.report.execution!=="reported-pretrained-execution")
    throw Error("Маска выпотов без настоящего запуска модели.");
   const classes=snapshot.effusion.report.evidence.fluidCandidates;
   for(const item of classes){
    if(item.labelId===2||item.labelId===3)
     complete(item.labelId===2?"pleural_effusion":"pericardial_effusion",
      item.modelPositiveNativeVoxelCount===0?0:1,
      item.modelUnvalidatedFluidLabelVolumeMl);
   }
  }
  if(snapshot.pe){
   same(snapshot.pe.sourceNiftiSHA256);
   complete("pulmonary_embolism",snapshot.pe.lesions.length,
     snapshot.pe.lesions.reduce((a,x)=>a+x.modelCandidateMl,0));
  }
  if(snapshot.nodes){
   same(snapshot.nodes.sourceNiftiSHA256);
   complete("mediastinal_nodes",snapshot.nodes.candidates.length,
     snapshot.nodes.candidates.reduce((a,x)=>a+x.candidateVolumeMl,0));
  }
 }else if(region==="abdomen"&&snapshot.abdomen){
  if(!source||snapshot.abdomen.sourceNiftiSha256!==source)
   throw Error("Подмена исходной КТ брюшной полости.");
  for(const [task,code] of [
    ["kidney_cysts","renal_cysts"],["liver_lesions","hepatic_lesions"],
    ["pancreatic_tumor","pancreatic_tumor"]] as const){
   const item=snapshot.abdomen.tasks[task];
   if(item?.status!=="completed")continue;
   if(item.report.task!==task)throw Error("Подмена модели патологической задачи.");
   if(item.report.schema==="opus-real-monai-pancreatic-tumor-source-candidates/v1"){
    complete(code,item.report.tumorCandidateComponents.length,
      item.report.tumorCandidateComponents.reduce((a,c)=>a+c.candidateVolumeMl,0));
   }else{
    const voxels=item.report.proposals.filter(c=>c.modelCandidateVoxels>0);
    complete(code,voxels.length,voxels.reduce((a,c)=>a+c.modelCandidateVolumeMl,0));
   }
  }
 }else if(region==="brain"){
  if(snapshot.ich){
   if(modality!=="CT"||snapshot.ich.modality!=="CT"||
      snapshot.ich.findings.some(f=>f.model.provider==="openrouter"))
    throw Error("Недопустимый источник ICH.");
   complete("brain_hemorrhage",snapshot.ich.findings.length,null);
  }
  if(snapshot.wmh){
   if(modality!=="MR")throw Error("WMH требует МРТ.");
   complete("white_matter_hyperintensities",snapshot.wmh.components.length,snapshot.wmh.totalMl);
  }
  if(snapshot.brain){
   if(modality!=="MR")throw Error("ISLES/BraTS требуют МРТ.");
   if(snapshot.brain.task==="stroke"){
    const r=snapshot.brain.modelRegions.ischemic_stroke;
    complete("ischemic_stroke",r?.components.length??0,
      r?.components.reduce((a,x)=>a+x.candidateVolumeMl,0)??0);
   }else if(snapshot.brain.task==="glioma"){
    // Three nested BraTS masks are the SAME pathology task. Never count them
    // as three independent tumors; use whole-tumor candidate count once.
    const r=snapshot.brain.modelRegions.whole_tumor;
    complete("glioma",r?.components.length??0,
      r?.components.reduce((a,x)=>a+x.candidateVolumeMl,0)??0);
   }
  }
 }
 const facts=TASKS_BY_REGION[region].map(task=>
  factMap.get(task)??{task,status:"not_assessed" as const,
     candidateCount:null,candidateVolumeMl:null});
 const result:SanitizedDetectorBundle={
  schema:"opus-sanitized-detector-consilium/v1",modality,region,facts,
  sourceIdentifiersSent:false,sourcePixelsSent:false,
  clinicalValidation:false,negativeDiagnosisPermitted:false,
 };
 if(!validateSanitizedDetectorBundle(result))
  throw Error("Данные детекторов для консилиума не прошли безопасную схему.");
 if(!result.facts.some(x=>x.status==="completed"))
  throw Error("Ни одна модель не завершилась. Нельзя генерировать заключение.");
 return result;
}
