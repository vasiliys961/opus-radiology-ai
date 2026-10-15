/** Verified three-human HRCT appearance reference, NOT a UIP/IPF detector.
 * Data derived from actual original SHA-verified LongCIU masks, completed
 * Action 38753711714; original complete numeric JSON SHA:
 * 8864abeb2d8c0f4363f3d422eb4f78f7b174d653e245b77b76d69b2594ec67ce
 */
export type HumanPatternKind="groundGlassOpacity"|"consolidation";
type HumanRater={mean2DDice:number;nonEmptyUnionSlices:number};
export type LongCIUExpertReference={
  schema:"opus-longciu-real-40slice-expert-hrct-patterns/v1";
  status:"original_three_expert_masks_vs_staple_confirmed_no_model_inference";
  source:"LongCIU";sourceDoi:"10.25820/data.007301";sourceRights:"ODC-By 1.0";
  originalGithubActionRun:38753711714;
  originalNumericArtifactId:11982242910;
  originalFullNumericArtifactSha256:string;
  sourceMirrorRevision:string;
  sourceImagesDownloaded:false;expertMaskFilesSha256Verified:true;
  originalStudySlices90AreIndependent2DPatients:true;
  authorsDesignatedTestSlices:40;
  stapleIsConsensusOfComparedAnnotators:true;
  classLabels:{"1":"ground_glass_opacity";"2":"consolidation"};
  test40:Record<HumanPatternKind,Record<"annotator1"|"annotator2"|"annotator3",HumanRater>>;
  original90HumanAnnotator1MeanGgoDice:0.77251;
  precomputedMedpsegMaskPresent:true;
  precomputedMedpsegSourceRegistrationValidated:false;
  precomputedMedpsegModelRunByOpus:false;
  medpsegGgoAndConsolidationScoresWithheldPendingRegistrationAudit:true;
  honeycombingAndTractionBronchiectasisPresent:false;
  fibrosingILDSubtypeDiagnosisPossible:false;
  sourceIsContiguous3DCT:false;
  clinicalValidation:false;
  limitations:string[];
};
const expected:{
 [key in HumanPatternKind]:{scores:number[];nonempty:number[]}
}={
  groundGlassOpacity:{scores:[.745559,.854955,.648818],nonempty:[40,40,40]},
  consolidation:{scores:[.515743,.580319,.615898],nonempty:[26,28,30]},
};
const isObject=(x:unknown):x is Record<string,unknown>=>!!x&&
 typeof x==="object"&&!Array.isArray(x);
export function parseLongCIUExpertReference(raw:string):LongCIUExpertReference {
 if(raw.length<256||raw.length>10000)
   throw Error("Внешний паспорт паттернов HRCT повреждён.");
 let parsed:unknown;
 try{parsed=JSON.parse(raw);}catch{throw Error("Паспорт не является JSON.");}
 if(!isObject(parsed))throw Error("Некорректная структура внешнего эталона.");
 const v=parsed;
 if(v.schema!=="opus-longciu-real-40slice-expert-hrct-patterns/v1"||
    v.status!=="original_three_expert_masks_vs_staple_confirmed_no_model_inference"||
    v.source!=="LongCIU"||v.sourceDoi!=="10.25820/data.007301"||
    v.sourceRights!=="ODC-By 1.0"||
    v.originalGithubActionRun!==38753711714||
    v.originalNumericArtifactId!==11982242910||
    v.originalFullNumericArtifactSha256!=="8864abeb2d8c0f4363f3d422eb4f78f7b174d653e245b77b76d69b2594ec67ce"||
    v.sourceMirrorRevision!=="c4b975090c16fabe59079a528dd920d956e16c66"||
    v.sourceImagesDownloaded!==false||
    v.expertMaskFilesSha256Verified!==true||
    v.originalStudySlices90AreIndependent2DPatients!==true||
    v.authorsDesignatedTestSlices!==40||
    v.stapleIsConsensusOfComparedAnnotators!==true||
    v.original90HumanAnnotator1MeanGgoDice!==.77251||
    v.precomputedMedpsegMaskPresent!==true||
    v.precomputedMedpsegSourceRegistrationValidated!==false||
    v.precomputedMedpsegModelRunByOpus!==false||
    v.medpsegGgoAndConsolidationScoresWithheldPendingRegistrationAudit!==true||
    v.honeycombingAndTractionBronchiectasisPresent!==false||
    v.fibrosingILDSubtypeDiagnosisPossible!==false||
    v.sourceIsContiguous3DCT!==false||
    v.clinicalValidation!==false)
    throw Error("Эталон HRCT не соответствует оригинальным результатам и научным ограничениям.");
 const labels=v.classLabels,table=v.test40;
 if(!isObject(labels)||labels["1"]!=="ground_glass_opacity"||
    labels["2"]!=="consolidation"||!isObject(table))
    throw Error("Подмена классификации матового стекла или консолидации.");
 for(const name of ["groundGlassOpacity","consolidation"] as const){
   const group=table[name];
   if(!isObject(group))throw Error("Эталонные маски паттернов отсутствуют.");
   for(let i=0;i<3;i++){
     const row=group["annotator"+(i+1)];
     if(!isObject(row)||row.mean2DDice!==expected[name].scores[i]||
        row.nonEmptyUnionSlices!==expected[name].nonempty[i])
        throw Error("Числа совпадений врачебных разметок не соответствуют исходным КТ.");
   }
 }
 if(!Array.isArray(v.limitations)||v.limitations.length!==4||
    v.limitations.some(s=>typeof s!=="string"||s.length>800))
    throw Error("Недостаёт исследовательских ограничений эталона.");
 return v as LongCIUExpertReference;
}
