import type {IchResearchReport} from "./ich-research";
import type {IchReferenceComparison} from "./ich-reference-comparison";

/** Offline consistency of an externally generated FULL case passport.
 * A JSON passport is never proof that the upstream model actually ran.
 */
export type IchCompletedCase={
 schema:"opus-ich-first-trained-public-case/v1";
 status:"real_trained_model_and_one_authorized_public_mask_pair_completed";
 sourceDatasetCitationUrl:string;checkpointSha256:string;wrapperSha256:string;
 officialSamihsSourceRevision:string;
 modelExecutionSeconds:number;device:string;
 inputFullVolumeProcessed:true;clinicalValidation:false;
 evidenceHashes:IchReferenceComparison["evidenceHashes"];
 metrics:{dice:number|null;iou:number|null;hd95Mm:number|null;
 predictedVolumeMl:number;expertMaskVolumeMl:number;
 falseNegativeVoxels:number;falsePositiveVoxels:number;
 expertFragmentsWithoutContact:number;modelFragmentsWithoutContact:number;
 expertPositiveSlicesWithoutOverlap:number};
};
const object=(x:unknown):Record<string,unknown>=>{
 if(!x||typeof x!=="object"||Array.isArray(x))throw Error("Повреждён итоговый паспорт ICH.");
 return x as Record<string,unknown>;
};
const equals=(a:unknown,b:unknown)=>a===b||(typeof a==="number"&&typeof b==="number"&&
 Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-8);
export function parseIchCompletedCase(raw:string,model:IchResearchReport,
 compare:IchReferenceComparison):IchCompletedCase{
 if(raw.length>2*1024*1024)throw Error("Итоговый паспорт превышает 2 МиБ.");
 const root=object(JSON.parse(raw));
 const m=object(root.metrics),h=object(root.evidenceHashes),files=object(root.files);
 const expected=compare.metrics;
 if(root.schema!=="opus-ich-first-trained-public-case/v1"||
   root.status!=="real_trained_model_and_one_authorized_public_mask_pair_completed"||
   root.modelId!=="samihs-ich-binary-ct"||
   root.clinicalValidation!==false||root.heldOutFromTrainingProven!==false||
   root.originalDicomSopMapped!==false||
   root.legalRightsIndependentlyVerifiedByOpus!==false||
   root.operatorAttestedRights!==true||root.upstreamModelAuditAttested!==true||
   root.sourceNativeIndexGridMatch!==true||
   root.publicPatientDataMustNotBePublished!==true||
   root.inputFullVolumeProcessed!==true||
   root.checkpointSha256!==model.model.checkpointSha256||
   root.wrapperSha256!==model.model.wrapperSha256||
   h.sourceSha256!==model.source.sha256||
   h.predictionSha256!==model.prediction.maskSha256||
   h.expertMaskSha256!==compare.evidenceHashes.expertMaskSha256||
   typeof root.sourceDatasetCitationUrl!=="string"||
   !/^https:\/\/[^\s]{4,500}$/.test(root.sourceDatasetCitationUrl)||
   typeof root.modelExecutionSeconds!=="number"||
   !Number.isFinite(root.modelExecutionSeconds)||root.modelExecutionSeconds<0||
   root.device!=="cuda:0"||
   typeof root.officialSamihsSourceRevision!=="string"||
   !/^[0-9a-f]{40}$/.test(root.officialSamihsSourceRevision)||
   files.modelMask!=="samihs-public-ich-mask.nii.gz"||
   files.modelInference!=="opus-ich-samihs-public-report.json"||
   files.expertComparison!=="ich-expert-3d-comparison.json"||
   files.componentContact!=="ich-expert-components.json"||
   files.nativeSliceAudit!=="ich-expert-native-slices.json")
   throw Error("Итоговый паспорт не связан с верифицированной КТ/SAMIHS/эталоном.");
 const fields=["dice","iou","hd95Mm","predictedVolumeMl","expertMaskVolumeMl",
  "falseNegativeVoxels","falsePositiveVoxels"] as const;
 for(const field of fields)if(!equals(m[field],expected[field]))
   throw Error("Итоговый паспорт содержит несогласованный показатель "+field+".");
 for(const field of ["expertFragmentsWithoutContact","modelFragmentsWithoutContact",
  "expertPositiveSlicesWithoutOverlap"]){
  if(typeof m[field]!=="number"||!Number.isSafeInteger(m[field])||m[field]<0)
   throw Error("Недостоверные пространственные ошибки ICH.");
 }
 return root as IchCompletedCase;
}
