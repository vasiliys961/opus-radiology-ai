/**
 * Public, pinned, already-executed pretrained-model evidence ONLY.
 * This adapter never accepts patient scans or arbitrary model reports.
 * LLMs receive limited numeric facts, never source pixels or source identities.
 */
export type PublicCaseId="lung-nodule"|"head-hemorrhage";
export type ResearchFact={id:string;label:string;detail:string};
export type PublicResearchCase={
  schema:"opus-public-model-review/v1";caseId:PublicCaseId;
  title:string;anatomy:string;modelNames:string[];
  sourceUrl:string; facts:ResearchFact[]; limitations:string[];
  patientStudyAnalyzed:false;clinicalValidation:false;liveInference:false;
};
export type PublicLLMReview={
  schema:"opus-public-llm-review/v1";
  rankedFacts:{factId:string;priority:"high"|"medium"|"low";reason:string}[];
  unresolvedQuestions:string[];
  summary:string;
};
const obj=(v:unknown):Record<string,unknown>=>{
  if(!v||typeof v!=="object"||Array.isArray(v))throw Error("invalid_public_evidence");
  return v as Record<string,unknown>;
};
const val=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:null;
const hash=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const fmt=(n:number,digits=3)=>n.toFixed(digits);
export function isPublicCaseId(v:unknown):v is PublicCaseId{
  return v==="lung-nodule"||v==="head-hemorrhage";
}
export function assemblePublicCase(id:PublicCaseId,first:unknown,second:unknown):PublicResearchCase{
  const a=obj(first), b=obj(second);
  if(id==="lung-nodule"){
    const study=obj(a.publicStudy),model=obj(a.model),coverage=obj(a.coverage);
    const reference=obj(b.independentPublishedLuna16ExpertReference);
    const secondModel=obj(b.model),secondStudy=obj(b.study);
    const comparisons=b.modelCandidatesCompared;
    const firstCandidate=Array.isArray(a.candidates)?obj(a.candidates[0]):null;
    const matched=Array.isArray(comparisons)?obj(comparisons[0]):null;
    const modelSha=model.weightsSha256;
    const d=matched?val(matched.centerDistanceToExpertMm):null;
    const score=firstCandidate?val(firstCandidate.rawClassificationScore):null;
    const diameter=val(reference.diameterMm);
    if(a.schema!=="opus-monai-luna16-real-single-ct-inference/v1"||
       a.status!=="genuine_trained_checkpoint_executed_on_public_ct"||
       b.schema!=="opus-monai-luna16-independent-expert-center-comparison/v1"||
       !hash(modelSha)||modelSha!==secondModel.checkpointSha256||
       study.sourceRawSha256!==secondStudy.sourceRawSha256||
       !hash(study.sourceRawSha256)||!hash(study.sourceMhdSha256)||
       model.modelCheckpointActualSha256Verified!==true||
       coverage.sourceFullCtProcessed!==true||
       a.readyForClinicalUse!==false||
       b.independentClinicalValidation!==false||b.datasetHoldoutFromModelTrainingVerified!==false||
       !Array.isArray(a.candidates)||a.candidates.length<1||
       b.researchReferenceCenterHitAtScorePoint5!==true||
       matched?.referenceCenterMatchAtScorePoint5!==true||
       score===null||score<0||score>1||d===null||d<0||d>1000||
       diameter===null||diameter<=0||
       a.candidates.length!==a.candidateCount)
      throw Error("public_nodule_provenance_mismatch");
    return {schema:"opus-public-model-review/v1",caseId:id,
      title:"Лёгочный узел · MONAI RetinaNet",anatomy:"КТ грудной клетки",
      modelNames:["MONAI RetinaNet 0.6.9"],
      sourceUrl:"https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38724788094",
      facts:[
        {id:"nodule-real-run",label:"Реальный инференс",detail:"Предобученная модель обработала одну публичную КТ LUNA16, а не текущее исследование врача."},
        {id:"nodule-candidate",label:"Кандидат модели",detail:"Максимальный score "+fmt(score,6)+" (не калиброванная вероятность заболевания)."},
        {id:"nodule-localization",label:"Пространственная локализация",detail:"Расстояние до опубликованного экспертного центра "+fmt(d)+" мм; экспертный диаметр "+fmt(diameter)+" мм."},
        {id:"nodule-holdout",label:"Независимость выборки",detail:"LUNA16 использовалась для обучения MONAI; независимость этого случая от обучения не подтверждена."},
      ],
      limitations:["Нет независимой FROC, чувствительности и оценки FP/скан.",
        "Координаты относятся к MetaImage LUNA16, не к загруженной DICOM/SOP-серии.",
        "Совпадение центра одного кандидата не доказывает клиническую эффективность."],
      patientStudyAnalyzed:false,clinicalValidation:false,liveInference:false};
  }
  const firstSource=obj(a.source),firstModel=obj(a.model),secondModel=obj(b);
  const primary=obj(a.seriesRawUncalibratedScores);
  const uncalibrated=val(primary.intraparenchymal);
  const voxels=val(secondModel.secondModelMaskPositiveVoxels);
  const volume=val(secondModel.secondModelUnvalidatedMaskVolumeMl);
  const overlap=val(secondModel.secondModelMaskShareWithinFirstModelBounds);
  if(a.schema!=="opus-ianpan-genuine-public-ich-research/v1"||
     b.schema!=="opus-public-ich-independent-two-model-consistency/v1"||
     !hash(firstSource.niftiSha256)||
     firstSource.niftiSha256!==secondModel.originalCtSha256||
     firstModel.checkpointSha256Verified!==true||
     firstSource.referenceLabelsOnlyPerihematomalEdema!==true||
     secondModel.independentRadiologistGroundTruthPresent!==false||
     secondModel.clinicalValidation!==false||
     secondModel.sourceHURescaleIndependentlyVerified!==false||
     uncalibrated===null||uncalibrated<0||uncalibrated>1||
     voxels===null||voxels<1||volume===null||volume<0||
     overlap===null||overlap<0||overlap>1)
    throw Error("public_ich_provenance_mismatch");
  return {schema:"opus-public-model-review/v1",caseId:id,
    title:"Кровоизлияние · два предобученных детектора",anatomy:"КТ головного мозга",
    modelNames:["ianpan/ct-head-hemorrhage-detection","TotalSegmentator cerebral_bleed"],
    sourceUrl:"https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38747034560",
    facts:[
      {id:"ich-real-runs",label:"Два реальных инференса",detail:"Обе предобученные модели обработали одну и ту же публичную КТ 512×512×25."},
      {id:"ich-first-candidate",label:"Первый кандидат",detail:"ianpan: внутрипаренхиматозный score "+fmt(uncalibrated,6)+" (некалиброванный); кандидаты на 7 срезах."},
      {id:"ich-second-mask",label:"Вторая маска",detail:"TotalSegmentator cerebral_bleed: "+voxels+" положительных вокселей, объём маски "+fmt(volume,3)+" мл; объём крови не подтверждён врачом."},
      {id:"ich-model-agreement",label:"Согласие моделей",detail:fmt(overlap*100,3)+"% маски второй модели попадает внутрь прямоугольных ROI первой; это НЕ Dice и НЕ чувствительность."},
      {id:"ich-reference",label:"Независимый эталон",detail:"Опубликованные маски исходной КТ описывают перифокальный отёк, а не кровь; экспертного эталона гематомы для случая нет."},
    ],
    limitations:["Оригинальный DICOM HU RescaleSlope/Intercept не подтверждён.",
      "Нет независимой маски крови, Dice, чувствительности или специфичности.",
      "Совпадение нейросетей не разрешает отрицательный диагноз и не доказывает истинность кровоизлияния."],
    patientStudyAnalyzed:false,clinicalValidation:false,liveInference:false};
}
const text=(v:unknown,max:number):v is string=>typeof v==="string"&&v.length>0&&v.length<=max;
export function parsePublicLLMReview(raw:string,caseData:PublicResearchCase):PublicLLMReview{
  if(raw.length>10000)throw Error("llm_response_too_large");
  const cleaned=raw.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
  const v=obj(JSON.parse(cleaned));
  const allowed=new Set(caseData.facts.map(f=>f.id));
  if(v.schema!=="opus-public-llm-review/v1"||
     !Array.isArray(v.rankedFacts)||v.rankedFacts.length<1||v.rankedFacts.length>6||
     !Array.isArray(v.unresolvedQuestions)||v.unresolvedQuestions.length>6||
     !v.unresolvedQuestions.every((s:unknown)=>text(s,250))||
     !text(v.summary,900))throw Error("invalid_llm_public_review");
  const seen=new Set<string>();
  for(const item of v.rankedFacts){
    const f=obj(item);
    if(typeof f.factId!=="string"||!allowed.has(f.factId)||seen.has(f.factId)||
       !["high","medium","low"].includes(String(f.priority))||!text(f.reason,350))
       throw Error("unbound_llm_fact");
    seen.add(f.factId);
  }
  return v as PublicLLMReview;
}
