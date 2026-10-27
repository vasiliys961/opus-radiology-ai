/** Strictly local, source-bound handoff from real detector dispatcher to
 * physician review/export. Never imports screenshots or forwards DICOM IDs
 * to a cloud service. Research candidates remain unverified until reviewed.
 */
import type {DicomSeries} from "./dicom-series.ts";
import type {DetectorDispatch} from "./dicom-detector-dispatch.ts";
import {validateEvidenceJson} from "./evidence-json.ts";

export type LocalDetectorReview={
 schema:"opus-local-detector-physician-review/v1";
 status:"unverified_research_draft";
 patientIdentityVerified:false;
 clinicianSigned:false;
 cloudTransmissionAuthorized:false;
 modality:"CT"|"MR";
 source:{seriesUid:string;frameCount:number;sourceSopCount:number};
 generatedAt:string;
 executors:Array<{
   target:string;
   coverage:"partially_assessed"|"not_assessed";
   findingsCount:number;
   warnings:string[];
 }>;
 blocked:Array<{target:string;reason:string}>;
 findings:Array<{
   findingId:string;
   target:string;
   anatomy:string;
   sign:string;
   status:"requires_recheck";
   model:{id:string;version:string|null;provider:"local"};
   source:{seriesUid:string;sopInstanceUid:string;frameIndex:0;slicePositionMm:number|null;
     localFileId:string};
   measurements:{diameterMm:number|null;volumeMl:number|null};
   limitations:string[];
 }>;
 conclusion:{
   kind:"source_linked_candidates_only"|"no_evaluable_diagnostic_findings";
   text:string;
   clinicalExclusionAllowed:false;
 };
 limitations:string[];
};

export function createLocalDetectorReview(
 series:DicomSeries,dispatch:DetectorDispatch,generatedAt:string,
):LocalDetectorReview {
 if(!series||!["CT","MR"].includes(series.modality)||!series.members.length||
   !Array.isArray(dispatch.executed)||!Array.isArray(dispatch.evidence)||
   !Array.isArray(dispatch.blocked)||dispatch.executed.length!==dispatch.evidence.length||
   dispatch.evidence.length>18||dispatch.blocked.length>100||
   typeof generatedAt!=="string"||!Number.isFinite(Date.parse(generatedAt))||
   new Date(generatedAt).toISOString()!==generatedAt)
   throw Error("Invalid local DICOM detector review input");

 const seen=new Set<string>(),sop=new Map<string,string>(),seriesUids=new Set<string>();
 for(const member of series.members){
   const meta=member.metadata;
   if(!meta.sopInstanceUid||!meta.seriesUid||!member.id||
      meta.modality!==series.modality||seen.has(meta.sopInstanceUid))
     throw Error("Unverified original DICOM source identity");
   seen.add(meta.sopInstanceUid);seriesUids.add(meta.seriesUid);
   sop.set(meta.seriesUid+"|"+meta.sopInstanceUid,member.id);
 }
 if(seriesUids.size!==1)throw Error("Mixed DICOM source series");
 const seriesUid=[...seriesUids][0];
 const seenExecutors=new Set<string>(),findings:LocalDetectorReview["findings"]=[],executors:LocalDetectorReview["executors"]=[];
 for(let index=0;index<dispatch.executed.length;index++){
   const target=dispatch.executed[index],e=dispatch.evidence[index];
   if(typeof target!=="string"||target.length>128||!target||
     seenExecutors.has(target)||!validateEvidenceJson(e)||
     e.modality!==series.modality||e.coverage==="assessed"||
     e.seriesReviewed.some(uid=>uid!==seriesUid))
     throw Error("Unverified or duplicate detector provenance");
   seenExecutors.add(target);
   if(e.findings.length>128||findings.length+e.findings.length>256)
     throw Error("Too many diagnostic candidates");
   for(const f of e.findings){
     const localFileId=sop.get(f.source.seriesUid+"|"+f.source.sopInstanceUid);
     if(f.status!=="requires_recheck"&&f.status!=="candidate"||
        f.model.provider!=="local"||f.source.frameIndex!==0||
        !localFileId||!f.source.sopInstanceUid)
       throw Error("Detector finding is not anchored to the opened original DICOM");
     findings.push({
       findingId:f.findingId,target,anatomy:f.anatomy,sign:f.sign,
       status:"requires_recheck",
       model:{id:f.model.id,version:f.model.version,provider:"local"},
       source:{seriesUid:f.source.seriesUid,sopInstanceUid:f.source.sopInstanceUid,
         frameIndex:0,slicePositionMm:f.source.slicePositionMm,localFileId},
       measurements:{diameterMm:f.measurements.diameterMm,volumeMl:f.measurements.volumeMl},
       limitations:[...f.limitations],
     });
   }
   executors.push({target,coverage:e.coverage,findingsCount:e.findings.length,
     warnings:[...e.warnings]});
 }
 const blocked=dispatch.blocked.map(v=>{
   if(!v||typeof v.target!=="string"||v.target.length>128||!v.target||
      typeof v.reason!=="string"||v.reason.length>500)
     throw Error("Malformed blocked detector status");
   return {target:v.target,reason:v.reason};
 });
 const hasCandidates=findings.length>0;
 return {
   schema:"opus-local-detector-physician-review/v1",
   status:"unverified_research_draft",
   patientIdentityVerified:false,clinicianSigned:false,cloudTransmissionAuthorized:false,
   modality:series.modality as "CT"|"MR",
   source:{seriesUid,frameCount:series.members.length,sourceSopCount:sop.size},
   generatedAt,executors,blocked,findings,
   conclusion:{
     kind:hasCandidates?"source_linked_candidates_only":"no_evaluable_diagnostic_findings",
     text:hasCandidates?
       "Найдены предварительные модельные кандидаты, привязанные к исходным DICOM. Требуются врачебная перепроверка и независимая клиническая валидация.":
       "Достоверное отрицательное заключение не сформировано. Отсутствие модельных находок или исполнителей не исключает патологию.",
     clinicalExclusionAllowed:false,
   },
   limitations:[
     "Это локальный неподписанный исследовательский черновик, а не окончательное врачебное заключение.",
     "Покрытие каждого детектора ограничено установленной моделью, протоколом и фактически обработанными срезами.",
     "Серия, SOP Instance UID и локальные имена связаны с исходными DICOM и могут быть чувствительными; экспорт хранить локально.",
     "Gemini и Opus не запускались этим экспортом; при отсутствии отдельного разрешения передача в облако запрещена.",
   ],
 };
}
