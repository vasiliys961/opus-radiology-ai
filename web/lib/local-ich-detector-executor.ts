/** Bridge verified local ICH worker output to existing automatic detector dispatch.
 * A caller must supply an actual trusted local worker invocation; no imported
 * public research JSON, mock result or model weights are embedded here.
 */
import type { DicomSeries } from "./dicom-series.ts";
import type { DetectorExecutor } from "./dicom-detector-dispatch.ts";
import {bindLocalIchToDicom,type IchBoundWorkerResult} from "./ich-native-dicom-binding.ts";

export type TrustedLocalIchRun=(series:DicomSeries,signal?:AbortSignal)=>Promise<IchBoundWorkerResult>;
export function createLocalIchExecutor(runTrustedWorker:TrustedLocalIchRun):DetectorExecutor {
  return {
    target:"intracerebral-hemorrhage",
    modality:"CT",
    eligible:series=>series.modality==="CT"&&series.volumeReady&&series.spatiallySorted&&
      series.members.length>=3&&series.members.length<=300&&
      series.members.every(member=>member.metadata.bodyRegion==="HEAD"&&
        member.metadata.imageRole!=="LOCALIZER"&&member.metadata.imageRole!=="DERIVED"&&
        !!member.metadata.sopInstanceUid&&!!member.metadata.seriesUid&&
        (!member.metadata.numberOfFrames||member.metadata.numberOfFrames===1)),
    run:async(series,signal)=>{
      if(signal?.aborted)throw Error("ICH run cancelled");
      const result=await runTrustedWorker(series,signal);
      if(signal?.aborted)throw Error("ICH run cancelled");
      return bindLocalIchToDicom(series,result).evidence;
    },
  };
}
