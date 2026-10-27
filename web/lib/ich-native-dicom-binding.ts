/** Fail-closed DICOM slice binding for a local ICH model's native-frame candidates.
 * Call ONLY after a trusted worker has verified exact source input SHA and
 * returned its ordered SOP manifest. Imported public NIfTI results cannot qualify.
 * This constructs navigable source evidence; it does not execute ICH inference.
 */
import type {DicomSeries} from "./dicom-series.ts";
import type {EvidenceJson} from "./evidence-json.ts";

const SHA=/^[0-9a-f]{64}$/;
export type IchNativeCandidate={
  sourceFrameIndex:number; sign:string; anatomy:string;
  /** Optional model measurement, never inferred from 2D heatmap. */
  volumeMl?:number|null;
};
export type IchBoundWorkerResult={
  schema:"opus-local-ich-native-slices/v1";
  modelId:string; modelVersion:string;
  /** Verified by the trusted local worker, not an arbitrary uploaded JSON. */
  inputSha256:string; verifiedSourceInputSha256:string;
  /** SOP UIDs in the EXACT order pixels were passed to the model. */
  orderedSopInstanceUids:readonly string[];
  candidates:readonly IchNativeCandidate[];
};
export type IchBoundNavigation={findingId:string;memberId:string;sourceFrameIndex:number};
export function bindLocalIchToDicom(
  series:DicomSeries,worker:IchBoundWorkerResult,
):{evidence:EvidenceJson;navigation:IchBoundNavigation[]} {
  if(series.modality!=="CT"||!series.volumeReady||!series.spatiallySorted||
    series.members.length<3||series.members.length>300||
    series.members.some(m=>m.metadata.bodyRegion!=="HEAD"||
      m.metadata.imageRole==="DERIVED"||m.metadata.imageRole==="LOCALIZER"||
      m.metadata.numberOfFrames!==null && m.metadata.numberOfFrames!==1))
    throw Error("Unsupported source CT head volume");
  const seriesUid=series.members[0].metadata.seriesUid;
  if(!seriesUid||series.members.some(m=>m.metadata.seriesUid!==seriesUid))
    throw Error("Unverified single source series UID");
  if(worker.schema!=="opus-local-ich-native-slices/v1"||
    !SHA.test(worker.inputSha256)||worker.inputSha256!==worker.verifiedSourceInputSha256||
    !worker.modelId||worker.modelId.length>120||
    !worker.modelVersion||worker.modelVersion.length>120||
    !Array.isArray(worker.orderedSopInstanceUids)||
    worker.orderedSopInstanceUids.length!==series.members.length||
    worker.orderedSopInstanceUids.some((uid,i)=>!uid||uid!==series.members[i].metadata.sopInstanceUid)||
    new Set(worker.orderedSopInstanceUids).size!==worker.orderedSopInstanceUids.length)
    throw Error("Local model input provenance or SOP order unverified");
  if(!Array.isArray(worker.candidates)||worker.candidates.length>128)
    throw Error("Unbounded ICH model candidates");
  const navigation:IchBoundNavigation[]=[];
  const findings:EvidenceJson["findings"]=[];
  worker.candidates.forEach((candidate,i)=>{
    const k=candidate.sourceFrameIndex,member=series.members[k];
    if(!Number.isSafeInteger(k)||k<0||!member||
       !candidate.sign||candidate.sign.length>500||
       !candidate.anatomy||candidate.anatomy.length>500||
       !(candidate.volumeMl===undefined||candidate.volumeMl===null||
          Number.isFinite(candidate.volumeMl)&&candidate.volumeMl>=0))
      throw Error("Invalid native-frame ICH candidate");
    const findingId="local-ich-"+i;
    findings.push({
      findingId,sign:candidate.sign,anatomy:candidate.anatomy,
      status:"requires_recheck",
      source:{seriesUid,sopInstanceUid:member.metadata.sopInstanceUid,
        frameIndex:0,slicePositionMm:null},
      measurements:{diameterMm:null,volumeMl:candidate.volumeMl??null},
      model:{id:worker.modelId,provider:"local",version:worker.modelVersion},
      limitations:["Local model candidate only; physician confirmation required",
        "Native source slice known; in-plane localization not established by this contract"],
    });
    navigation.push({findingId,memberId:member.id,sourceFrameIndex:k});
  });
  return {evidence:{
    schema:"opus-evidence/v1",modality:"CT",coverage:findings.length?"partially_assessed":"not_assessed",
    seriesReviewed:[seriesUid],findings,
    warnings:["Research-only ICH model; uncalibrated candidate findings, not a diagnosis",
      "Source series order and model input SHA must be independently verified by local worker",
      "Empty model output never excludes hemorrhage"],
  },navigation};
}
