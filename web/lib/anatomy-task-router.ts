/** DICOM-metadata-only, fail-closed anatomical AI task planner.
 * Does not inspect image pixels, infer diseases, execute models, or transmit files.
 * An allowlisted BodyPartExamined is NOT proof of complete organ coverage.
 */
import type {DicomSeries,TechnicalDicomMetadata} from "./dicom-series.ts";

export type AnatomicalTaskId="ct-chest-lobes"|"ct-abdomen-organs"|"mr-brain-multisequence";
export type RouteReason=
  "geometry_unverified" | "region_conflict" | "protocol_role_unverified" |
  "multiple_studies" | "source_incomplete_or_unknown" |
  "ct_calibration_and_phase_unverified" | "mr_exact_sequences_unverified" |
  "mr_4_series_not_confirmed" | "clinical_coverage_unknown" |
  "weights_not_connected" | "server_patient_use_blocked";
export type AnatomicalTaskRoute={
  schema:"opus-anatomical-task-route/v1";
  id:AnatomicalTaskId;
  title:string;
  modality:"CT"|"MR";
  bodyRegion:"CHEST"|"ABDOMEN"|"HEAD";
  modelCandidate:string;
  inputSeriesKeys:string[];
  technicalHints:string[];
  reasons:RouteReason[];
  preparation:"review_source"|"needs_series_and_protocol";
  execution:"not_connected";
  canRun:false;
  canIssueNegativeFinding:false;
  fullCoverageVerified:false;
  clinicallyValidated:false;
};

const exactRegion=(s:DicomSeries,region:AnatomicalTaskRoute["bodyRegion"])=>{
  const codes=s.members.map(m=>m.metadata.bodyRegion??null);
  return codes.length>0&&codes.every(c=>c===region);
};
const uniqueRegion=(s:DicomSeries)=>{
  const codes=new Set(s.members.map(m=>m.metadata.bodyRegion??null));
  return codes.size===1&&!codes.has(null);
};
const primary=(s:DicomSeries)=>s.members.length>0&&
  s.members.every(m=>m.metadata.imageRole==="PRIMARY"&&(m.metadata.numberOfFrames??1)===1);
const sameUid=(series:DicomSeries[])=>{
  const ids=new Set(series.flatMap(s=>s.members.map(m=>m.metadata.studyUid)));
  return ids.size===1&&![...ids].some(uid=>typeof uid!=="string"||!/^\d+(\.\d+)+$/.test(uid));
};
const fullStudy=(series:DicomSeries[])=>series.length>0&&sameUid(series);
const technicalHint=(m:TechnicalDicomMetadata)=>{
  const tr=m.repetitionTimeMs,te=m.echoTimeMs,ti=m.inversionTimeMs;
  if(m.mrSequenceCodes?.includes("IR")&&typeof ti==="number"&&ti>=1000&&
    typeof tr==="number"&&tr>=1500)return "IR/FLAIR-подобные параметры (не подтверждено)";
  if(typeof tr==="number"&&typeof te==="number"){
    if(tr>=1500&&te>=70)return "T2-подобные параметры (не подтверждено)";
    if(tr<=900&&te<=40)return "T1-подобные параметры (не подтверждено)";
  }
  return "МР-последовательность не определена";
};
const make=(args:Omit<AnatomicalTaskRoute,"schema"|"execution"|"canRun"|
  "canIssueNegativeFinding"|"fullCoverageVerified"|"clinicallyValidated">):AnatomicalTaskRoute=>({
  schema:"opus-anatomical-task-route/v1",...args,
  execution:"not_connected",canRun:false,canIssueNegativeFinding:false,
  fullCoverageVerified:false,clinicallyValidated:false,
});

/** Only source-backed task candidates. Unknown region/modality generates no model task.
 * No automatic switching from one model to a different or paid provider.
 */
export function planAnatomicalTasks(series:readonly DicomSeries[],unindexed=0):AnatomicalTaskRoute[]{
  if(!Number.isSafeInteger(unindexed)||unindexed<0)throw Error("Invalid unindexed series count");
  const routes:AnatomicalTaskRoute[]=[];
  const ct=[["CHEST","ct-chest-lobes","Доли лёгких · КТ грудной клетки","TotalSegmentator (experimental public CT only)"],
            ["ABDOMEN","ct-abdomen-organs","Органы брюшной полости · КТ","TotalSegmentator CT total (candidate only)"]] as const;
  for(const [region,id,title,modelCandidate] of ct){
    const candidates=series.filter(s=>s.modality==="CT"&&s.members.some(m=>m.metadata.bodyRegion===region));
    if(!candidates.length)continue;
    for(const s of candidates){
      const reasons:RouteReason[]=[];
      if(!exactRegion(s,region)||!uniqueRegion(s))reasons.push("region_conflict");
      if(!primary(s))reasons.push("protocol_role_unverified");
      if(!s.volumeReady||!s.spatiallySorted)reasons.push("geometry_unverified");
      if(!fullStudy([s])||!sameUid([s]))reasons.push("multiple_studies");
      if(unindexed>0)reasons.push("source_incomplete_or_unknown");
      reasons.push("ct_calibration_and_phase_unverified","clinical_coverage_unknown",
                   "weights_not_connected","server_patient_use_blocked");
      routes.push(make({id,title,modality:"CT",bodyRegion:region,
        modelCandidate,inputSeriesKeys:[s.key],technicalHints:[
          region==="CHEST"?
            "Обученная модель лёгочных долей прошла отдельный публичный Linux/Chromium тест; запуск из Study Intelligence не подключён.":
            "Для печени, почек и селезёнки требуется отдельная модель/метки/лицензия; они не установлены этим маршрутом.",
          "Контрастная фаза и HU не проверялись на пикселях; полнота органа неизвестна.",
        ],reasons,preparation:reasons.some(x=>["region_conflict","protocol_role_unverified",
          "geometry_unverified"].includes(x))?"needs_series_and_protocol":"review_source"}));
    }
  }
  const heads=series.filter(s=>s.modality==="MR"&&s.members.some(m=>m.metadata.bodyRegion==="HEAD"));
  // Do not combine heads from different StudyInstanceUIDs into a phantom brain protocol.
  const groups:DicomSeries[][]=[];
  for(const s of heads){
    const uid=s.members[0]?.metadata.studyUid;
    const group=typeof uid==="string"&&uid?groups.find(g=>g[0].members[0]?.metadata.studyUid===uid):undefined;
    if(group)group.push(s);else groups.push([s]);
  }
  for(const group of groups){
    const issues:RouteReason[]=[];
    if(group.some(s=>!exactRegion(s,"HEAD")))issues.push("region_conflict");
    if(group.some(s=>!primary(s)))issues.push("protocol_role_unverified");
    if(group.some(s=>!s.volumeReady||!s.spatiallySorted))issues.push("geometry_unverified");
    if(!sameUid(group))issues.push("multiple_studies");
    if(unindexed>0)issues.push("source_incomplete_or_unknown");
    if(group.length<4)issues.push("mr_4_series_not_confirmed");
    // Metadata timing hints can never certify T1+T1c+T2+FLAIR, registered
    // sequences, contrast phase or task-specific model input requirements.
    issues.push("mr_exact_sequences_unverified","clinical_coverage_unknown",
                "weights_not_connected","server_patient_use_blocked");
    const hints=[...new Set(group.map(s=>technicalHint(s.members[0].metadata)))].sort();
    routes.push(make({
      id:"mr-brain-multisequence",
      title:"Головной мозг · мультипараметрическая МРТ",
      modality:"MR",bodyRegion:"HEAD",
      modelCandidate:"BraTS/nnU-Net checkpoint (not installed)",
      inputSeriesKeys:group.map(s=>s.key),
      technicalHints:[
        ...hints,
        "Для сегментации опухолевых областей требуются подтверждённые T1, T1c, T2, FLAIR и регистрация серий; по TR/TE/TI это не установить.",
        "Исследовательского чекпойнта мозга и его эталонного теста пока нет.",
      ],
      reasons:issues,preparation:"needs_series_and_protocol",
    }));
  }
  return routes;
}
