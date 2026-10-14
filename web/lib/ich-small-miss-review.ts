/** Local, unsigned clinician notes for expert-mask FN candidates.
 * No DICOM or mask pixels in this output; source hashes bind the review
 * to one externally evaluated study without claiming authenticated authorship.
 */
import type {IchComponentEvidence} from "./ich-component-evidence";

export type SmallMissDecision = {
  status:"recheck"|"supports_expert_mark"|"disputes_expert_mark";
  note:string;
};
const VALID=new Set(["recheck","supports_expert_mark","disputes_expert_mark"]);
export function buildSmallMissLocalReview(
  source:IchComponentEvidence,
  decisions:Record<number,SmallMissDecision>,
  createdAt:string=new Date().toISOString(),
) {
  const candidates=source.componentEvidence.submilliliterReviewCandidates;
  if(!candidates||source.clinicalValidation!==false)
    throw Error("Нет проверенного источника экспертных пропусков.");
  if(!/^\d{4}-\d{2}-\d{2}T/.test(createdAt)||
     !Number.isFinite(Date.parse(createdAt)))
    throw Error("Время локальной записи некорректно.");
  const allowed=new Set(candidates.map(f=>f.componentIndex));
  if(Object.keys(decisions).some(x=>!Number.isSafeInteger(Number(x))||
       !allowed.has(Number(x))))
    throw Error("Оценка относится к неизвестной экспертной компоненте.");
  const records=candidates.flatMap(fragment=>{
    const d=decisions[fragment.componentIndex];
    if(!d)return [];
    if(!VALID.has(d.status)||typeof d.note!=="string"||
       d.note.length>1000||(!d.note.trim()&&d.status==="disputes_expert_mark"))
      throw Error("Недопустимый статус или комментарий к экспертной компоненте.");
    const k=fragment.reviewSliceIndexK;
    if(!Number.isSafeInteger(k)||k===undefined||
       k<fragment.boundsVoxelMin[2]||k>fragment.boundsVoxelMax[2])
      throw Error("Нет проверенного исходного среза компоненты.");
    return [{
      componentIndex:fragment.componentIndex,
      nativeNiftiSliceK:k,
      expertFragmentVolumeMl:fragment.volumeMl,
      missedExpertVoxels:fragment.voxelCount-fragment.overlapVoxels,
      status:d.status,
      note:d.note.trim(),
    }];
  });
  if(!records.length)throw Error("Нет оценённых фрагментов для экспорта.");
  return {
    schema:"opus-ich-small-miss-local-review/v1" as const,
    provenance:"imported_public_mask_comparison" as const,
    reviewStatus:"unsigned_unverified_local_clinician_notes" as const,
    reviewerIdentityVerified:false,
    clinicalValidation:false,
    createdAt,
    evidenceHashes:{...source.evidenceHashes},
    referenceLabel:source.referenceLabel,
    entries:records,
    limitations:[
      "Review annotations are not identity-verified or digitally signed.",
      "The referenced 3D components are NOT automatically proven individual hemorrhages.",
      "A review comment is not a clinically validated sensitivity estimate.",
      "NIfTI slice k is not bound to source DICOM SOP UID.",
    ],
  };
}
