/** Explicitly sourced CT chest extrapulmonary observations, research-only. */
export const CHEST_FINDINGS={
 mediastinum:["mediastinal_lymph_nodes","hilar_lymph_nodes","mediastinal_mass","pneumomediastinum"],
 heart:["cardiomegaly","pericardial_effusion","coronary_calcification","pericardial_calcification"],
 great_vessels:["aortic_dilatation","aortic_calcification","pulmonary_artery_enlargement"],
 pleura:["pleural_effusion","pleural_thickening","pneumothorax"],
 bones:["rib_fracture","bone_lesion","sternal_lesion"],
 spine:["vertebral_compression","vertebral_lesion","degenerative_changes"]
} as const;
export type ChestRegion=keyof typeof CHEST_FINDINGS;
export type ChestFinding=(typeof CHEST_FINDINGS)[ChestRegion][number];
export type ChestObservation={
 region:ChestRegion; finding:ChestFinding; slice:number;
 readerConfirmed:boolean; contrast:"unknown"|"noncontrast"|"contrast";
 measurementMm?:number;
};
export type ChestReport={
 status:"insufficient_evidence"|"research_observations";
 evidence:{region:ChestRegion;finding:ChestFinding;slice:number;measurementMm?:number;limitations:string[]}[];
 missing:string[];
 clinicalValidation:false;
};
const urgent=new Set<ChestFinding>(["pneumothorax","pneumomediastinum"]);
export function interpretChestObservations(input:ChestObservation[]):ChestReport {
 if(!Array.isArray(input)||input.length>50)throw Error("Некорректный список находок.");
 const evidence:ChestReport["evidence"]=[];
 const missing:string[]=[];
 for(const item of input){
   if(!item||!Object.prototype.hasOwnProperty.call(CHEST_FINDINGS,item.region)||
      !(CHEST_FINDINGS[item.region] as readonly string[]).includes(item.finding)||
      !Number.isSafeInteger(item.slice)||item.slice<1||item.slice>100000||
      !["unknown","noncontrast","contrast"].includes(item.contrast)||
      (item.measurementMm!==undefined&&(!Number.isFinite(item.measurementMm)||item.measurementMm<=0||item.measurementMm>500)))
     throw Error("Неверная анатомическая область, признак, размер или исходный срез.");
   if(!item.readerConfirmed){missing.push("Не все находки подтверждены врачом.");continue;}
   const limitations:string[]=[];
   if(item.contrast==="unknown")limitations.push("Тип контрастирования не установлен.");
   if(item.finding==="aortic_dilatation"||item.finding==="pulmonary_artery_enlargement"){
     if(item.measurementMm===undefined)limitations.push("Диаметр не измерен; размер сосуда не подтверждён количественно.");
   }
   if(item.finding==="cardiomegaly")limitations.push("Оценка кардиомегалии зависит от фазы и протокола КТ; без измерения не подтверждена.");
   if(item.finding==="coronary_calcification")limitations.push("Обычная КТ грудной клетки не является валидированным количественным coronary calcium score.");
   if(item.finding==="mediastinal_lymph_nodes"||item.finding==="hilar_lymph_nodes")limitations.push("Для оценки лимфоузлов необходим короткий диаметр, локализация и клинический контекст.");
   if(item.region==="spine"||item.region==="bones")limitations.push("Для оценки костной структуры необходим просмотр в костном окне и мультипланарных реконструкциях.");
   if(urgent.has(item.finding))limitations.push("Потенциально срочная находка: требуется незамедлительная клиническая оценка, не автоматический диагноз.");
   evidence.push({region:item.region,finding:item.finding,slice:item.slice,measurementMm:item.measurementMm,limitations});
 }
 if(evidence.length===0)missing.push("Нет подтверждённых находок с источниками.");
 missing.push("Отсутствие отмеченных находок не исключает патологию.");
 return {status:evidence.length?"research_observations":"insufficient_evidence",evidence,missing,clinicalValidation:false};
}
