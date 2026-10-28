/** Unsigned, LOCAL-only review of authentic ianpan / WMH candidates on the
 * exact selected DICOM series. No clinical certainty, no "normal study".
 */
import type {DicomSeries} from "./dicom-series.ts";
import type {EvidenceJson} from "./evidence-json.ts";
import type {BoundWmh} from "./wmh-source-review.ts";

export type NativeDraftInput=
  |{kind:"ianpan-ich";result:EvidenceJson}
  |{kind:"wmh-flair";result:BoundWmh};
export type NativeDraftDecision="accepted"|"rejected"|"unreviewed";
export type NativeDicomDigest={sopInstanceUid:string;sha256:string};

export function createNativePhysicianDraft(
  series:DicomSeries,input:NativeDraftInput,decisions:Readonly<Record<string,"accepted"|"rejected">>,
  reportText:string,sourceHashes:readonly NativeDicomDigest[],preparedAt:string,
){
  if(!reportText.trim()||reportText.length>12000||!Number.isFinite(Date.parse(preparedAt)))
    throw Error("Нужен ограниченный, датированный редактируемый черновик.");
  if(!series.members.length||!series.volumeReady||!series.spatiallySorted||
     sourceHashes.length!==series.members.length)
    throw Error("Невозможно связать черновик с проверенной исходной DICOM-серией.");
  const headers=series.members.map(m=>m.metadata);
  const seriesUid=headers[0].seriesUid,studyUid=headers[0].studyUid;
  if(!seriesUid||!studyUid||headers.some(m=>m.seriesUid!==seriesUid||m.studyUid!==studyUid))
    throw Error("Смешанные DICOM UID в черновике.");
  const digests=sourceHashes.map((x,i)=>{
    if(x.sopInstanceUid!==headers[i].sopInstanceUid||
       !/^[0-9a-f]{64}$/.test(x.sha256))
      throw Error("Оригинальные SHA-256 DICOM не соответствуют выбранным срезам.");
    return {...x,sliceIndex:i};
  });
  const review=(key:string):NativeDraftDecision=>decisions[key]??"unreviewed";
  let findings:Array<Record<string,unknown>>;
  let provenance:Record<string,unknown>;
  let warnings:string[];
  if(input.kind==="ianpan-ich"){
    if(series.modality!=="CT"||input.result.modality!=="CT")
      throw Error("Ожидалась исходная КТ головы.");
    findings=input.result.findings.map((finding,i)=>{
      const idx=headers.findIndex(m=>m.sopInstanceUid===finding.source.sopInstanceUid&&
        m.seriesUid===finding.source.seriesUid);
      if(idx<0||finding.source.frameIndex!==0)throw Error("Невозможно привязать ICH-находку к исходному DICOM.");
      return {key:"ich-"+i,findingId:finding.findingId,sourceSopInstanceUid:finding.source.sopInstanceUid,
        sliceIndex:idx,sign:finding.sign,anatomy:finding.anatomy,
        measurements:finding.measurements,model:finding.model,
        originalStatus:finding.status,physicianDecision:review("ich-"+i),
        limitations:finding.limitations};
    });
    provenance={route:input.kind,coverage:input.result.coverage,
      seriesReviewed:input.result.seriesReviewed,sourceProof:"worker compared SHA-256 against preapproved original public DICOM"};
    warnings=[...input.result.warnings];
  }else{
    if(series.modality!=="MR")throw Error("Ожидалась исходная FLAIR МРТ.");
    findings=input.result.components.map((c,i)=>{
      const idx=Math.floor((c.sourceVoxelBoundsInclusive[0][2]+c.sourceVoxelBoundsInclusive[1][2])/2);
      const sop=headers[idx]?.sopInstanceUid;
      if(!sop)throw Error("WMH-компонент не привязан к исходному срезу.");
      return {key:"wmh-"+c.component,component:c.component,sourceSopInstanceUid:sop,
        sliceIndex:idx,volumeMl:c.volumeMl,sourceVoxelBoundsInclusive:c.sourceVoxelBoundsInclusive,
        centroidNiftiRasMm:c.centroidNiftiRasMm,physicianDecision:review("wmh-"+c.component)};
    });
    provenance={route:input.kind,model:"original wmh_seg fold0",
      sourceFLAIRSHA256:input.result.sourceHash,checkpointSHA256:input.result.checkpointHash,
      totalPredictedHyperintensityMl:input.result.totalMl};
    warnings=["FLAIR-гиперинтенсивности неспецифичны; причинный диагноз не установлен."];
  }
  return {schema:"opus-native-physician-unsigned-draft/v1" as const,
    status:"unsigned_research_only" as const,preparedAt,modality:series.modality,
    studyUid,seriesUid,sourceDicomSha256:digests,provenance,
    findings,physicianEditedPreliminaryText:reportText.trim(),
    limitations:[...warnings,
      "Проанализирована только выбранная серия и только доступным исполнителем.",
      "Неоценённые области и отсутствие кандидатов не равнозначны норме.",
      "Не является подписанным заключением; независимая клиническая точность не установлена."]};
}
