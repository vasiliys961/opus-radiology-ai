/** Research-only rule-based HRCT feature synthesis.
 * Explicit physician observations only; never infers pathology from DICOM metadata.
 * This is a descriptive differential, not a validated classifier or ATS guideline engine.
 */
export const ILD_FEATURES = [
 "ground_glass","reticulation","honeycombing","traction_bronchiectasis",
 "consolidation","mosaic_attenuation","centrilobular_nodules",
 "perilymphatic_nodules","subpleural_sparing"
] as const;
export type IldFeature=typeof ILD_FEATURES[number];
export type Distribution="unknown"|"basal_subpleural"|"peribronchovascular"|"upper_mid"|"diffuse"|"random";
export type IldObservations={
 features:IldFeature[];
 distribution:Distribution;
 axialSourceRefs:string[];
 readerConfirmed:boolean;
};
export type IldPatternSummary={
 status:"insufficient_evidence"|"research_differential_only";
 describedFeatures:IldFeature[];
 distribution:Distribution;
 candidates:{name:string;support:IldFeature[];caveat:string}[];
 missing:string[];
 requiresPhysicianReview:true;
 clinicalValidation:false;
};
function candidate(name:string, support:IldFeature[], caveat:string){
 return {name,support,caveat};
}
export function interpretIldObservations(value:IldObservations):IldPatternSummary {
 if(!value||!Array.isArray(value.features)||value.features.length>ILD_FEATURES.length||
   value.features.some(f=>!ILD_FEATURES.includes(f))||
   new Set(value.features).size!==value.features.length||
   !["unknown","basal_subpleural","peribronchovascular","upper_mid","diffuse","random"].includes(value.distribution)||
   !Array.isArray(value.axialSourceRefs)||value.axialSourceRefs.length>32||
   value.axialSourceRefs.some(s=>typeof s!=="string"||s.length>120))
   throw Error("Некорректные данные признаков HRCT.");
 const missing:string[]=[];
 if(!value.readerConfirmed)missing.push("Врач не подтвердил признаки на исходной КТ.");
 if(value.axialSourceRefs.length===0)missing.push("Не указаны исходные срезы для проверки находок.");
 if(value.distribution==="unknown")missing.push("Не определено преобладающее распределение изменений.");
 if(!value.features.length)missing.push("Морфологические признаки не указаны.");
 const base={describedFeatures:[...value.features],distribution:value.distribution,
   requiresPhysicianReview:true as const, clinicalValidation:false as const};
 if(missing.length)return {...base,status:"insufficient_evidence" as const,candidates:[],missing};
 const f=new Set(value.features);
 const candidates: IldPatternSummary["candidates"]=[];
 if(value.distribution==="basal_subpleural" && (f.has("honeycombing")||f.has("traction_bronchiectasis")) &&
    f.has("reticulation"))
   candidates.push(candidate("UIP-подобный морфологический комплекс",
    ["reticulation",...(["honeycombing","traction_bronchiectasis"] as IldFeature[]).filter(x=>f.has(x))],
    "Не является классификацией UIP, диагнозом IPF или доказательством отсутствия альтернативных признаков."));
 if(f.has("ground_glass")&&(f.has("reticulation")||f.has("subpleural_sparing")))
   candidates.push(candidate("NSIP-подобный комплекс",
     ["ground_glass",...(["reticulation","subpleural_sparing"] as IldFeature[]).filter(x=>f.has(x))],
     "Возможны воспалительные, лекарственные и другие причины; необходим клинический контекст."));
 if(f.has("consolidation")&&(value.distribution==="peribronchovascular"||value.distribution==="diffuse"))
   candidates.push(candidate("OP-подобный комплекс",["consolidation"],
     "Консолидация неспецифична; инфекция и другие причины не исключены."));
 if(f.has("mosaic_attenuation")&&f.has("centrilobular_nodules"))
   candidates.push(candidate("Признаки, встречающиеся при HP",["mosaic_attenuation","centrilobular_nodules"],
     "Нужны экспираторные серии, анамнез экспозиций и мультидисциплинарное сопоставление."));
 if(f.has("perilymphatic_nodules"))
   candidates.push(candidate("Перилимфатический узелковый паттерн",["perilymphatic_nodules"],
     "Саркоидоз — одна из причин, но по одному признаку диагноз не устанавливается."));
 if(!candidates.length)missing.push("Комбинация не соответствует заложенным описательным шаблонам; это не означает норму.");
 missing.push("Для нозологии: анамнез экспозиций/лекарств, аутоиммунные признаки, PFT, динамика и заключение специалиста.");
 return {...base,status:"research_differential_only",candidates,missing};
}
