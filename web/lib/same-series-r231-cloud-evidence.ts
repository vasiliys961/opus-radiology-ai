/**
 * Browser-only bridge from a SAME-SERIES genuine local R231 lung segmentation
 * to bounded numerical facts allowed in an already reviewed cloud Vision pilot.
 *
 * A series key is a live UI scoping handle, NOT a patient identity certificate.
 * No DICOM pixels, UIDs, local file IDs, hashes, names or reader notes leave
 * this module. Never infer pathology from anatomy masks.
 */
import {localLungFacts,type LocalLungFacts} from "./local-lung-review.ts";
import type {SegmentationEvidence} from "./segmentation-evidence.ts";
import type {DicomSeries} from "./dicom-series.ts";

export type CapturedLocalSpecialist={
  seriesKey:string;
  evidence:SegmentationEvidence;
};

const SHA=/^[0-9a-f]{64}$/;
const sameGeometry=(a:SegmentationEvidence["source"]["geometry"],
  b:SegmentationEvidence["mask"]["geometry"]) =>
  a.dimensions.length===3 && b.dimensions.length===3 &&
  a.dimensions.every((v,i)=>v===b.dimensions[i]) &&
  a.affineLps.length===12 && b.affineLps.length===12 &&
  a.affineLps.every((v,i)=>Number.isFinite(v) &&
    Number.isFinite(b.affineLps[i]) && Math.abs(v-b.affineLps[i])<1e-3);

/** Return null for absence/other-series evidence; throw on forgery or source drift. */
export function sameSeriesR231Facts(
  currentSeries:DicomSeries|null|undefined,
  captured:CapturedLocalSpecialist|null|undefined,
):LocalLungFacts|null{
  if(!currentSeries||!captured||captured.seriesKey!==currentSeries.key)return null;
  const evidence=captured.evidence;
  if(currentSeries.modality!=="CT"||!currentSeries.volumeReady||
     !currentSeries.spatiallySorted||currentSeries.members.length<3||
     evidence.source.modality!==currentSeries.modality ||
     evidence.source.frameCount!==currentSeries.members.length ||
     evidence.source.frameCount!==evidence.source.geometry.dimensions[2] ||
     evidence.source.scope!=="selected-series-only" ||
     evidence.source.coverage!=="not-confirmed"||
     evidence.producer.executionMode!=="local" ||
     evidence.producer.kind!=="specialist-model" ||
     !SHA.test(evidence.source.sourceIdentitySha256)||
     !SHA.test(evidence.source.inputSha256)||
     !SHA.test(evidence.mask.sha256)||
     !sameGeometry(evidence.source.geometry,evidence.mask.geometry))
    throw Error("R231_evidence_not_bound_to_selected_series");
  // Original source result/weights + both lung labels are verified by
  // existing narrow R231 parser. No trust in arbitrary imported JSON.
  return localLungFacts(evidence);
}
