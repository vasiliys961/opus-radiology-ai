/** Offer an independent local Vision route when no pathology detector matches.
 * This merely opens local frame/OCR preparation. It does not grant cloud
 * permission, diagnose unsampled anatomy, or synthesize detector evidence.
 */
import type {DicomSeries} from "./dicom-series.ts";
import {planVisionFrameSamples} from "./vision-frame-plan.ts";

export function eligibleVisionOnlyFallback(series:DicomSeries,
 availableFiles:ReadonlySet<string>):boolean{
 if((series.modality!=="CT"&&series.modality!=="MR")||
    series.members.length<2||series.members.some(member=>
      !availableFiles.has(member.id)||
      member.metadata.imageRole==="LOCALIZER"||
      member.metadata.imageRole==="DERIVED"))return false;
 return planVisionFrameSamples([series],series.key).status==="ready-for-local-preview";
}
