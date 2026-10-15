/** Independently executed REAL cerebral_bleed versus independently executed
 * ianpan source ROIs. This is model agreement NOT an expert hematoma metric.
 * Source: original completed GitHub Action #38747034560 artifact #11980401798,
 * original byte-identical JSON SHA-256 cb12ca4ae7bc115a5e82a6190cfcfa83bdadabe958227f918bd8cb94b0992234.
 */
import type {IchAlternativeReport} from "./ianpan-ich-report";

export type GenuineIchDualModelEvidence={
 schema:"opus-public-ich-independent-two-model-consistency/v1";
 status:"two_genuine_pretrained_models_on_one_original_public_ct_not_expert_validated";
 originalCtSha256:string;
 firstModelReportSha256:string;
 secondModel:"TotalSegmentator cerebral_bleed";
 secondModelTask:150;
 officialWeightsRelease:"v2.0.0-weights";
 officialWeightsArchiveSha256:string;
 secondModelOriginalMaskSha256:string;
 originalShapeXYZ:[512,512,25];
 sourceHURescaleIndependentlyVerified:false;
 originalReferenceLabelsArePerihematomalEdema:true;
 firstModelSubtypeCandidateBoundingBoxes:7;
 secondModelMaskPositiveVoxels:10875;
 secondModelUnvalidatedMaskVolumeMl:12.96401;
 secondModelSourceSliceIndices:number[];
 secondModelMaskVoxelsInsideFirstModelBoundingBoxUnion:10862;
 secondModelMaskShareWithinFirstModelBounds:0.9988046;
 secondModelNegativeDiagnosticConclusionAllowed:false;
 independentRadiologistGroundTruthPresent:false;
 segmentationDiceAgainstExpertMask:null;
 clinicalLesionTruePositive:null;
 clinicalValidation:false;
 limitations:string[];
};
const expected={
 source:"0543a46065314468fe7ab18b9187277ae1affc4e7c864d0fd8ae608afa554a95",
 first:"c121d869f4358de9197232fc1c6eeb5ec2f6f8977af3e28ffb8130dcba365f62",
 secondWeights:"cd9a41917f134dd20f1aba877c7af4cabedf144f0f7aa1c1d16d6376b2425bb4",
 secondMask:"9ef977dd844a9df2ddc547a397d1ff52b3a4284d32b4b89f2afe91321d5f5f0b",
 artifactJson:"cb12ca4ae7bc115a5e82a6190cfcfa83bdadabe958227f918bd8cb94b0992234",
};
const validRecord=(r:unknown):r is Record<string,unknown>=>!!r&&
 typeof r==="object"&&!Array.isArray(r);
export function parseGenuineIchTwoModelEvidence(raw:string,report:IchAlternativeReport,
                                                 firstReportSha:string,
                                                 verifiedArtifactJsonSha:string):GenuineIchDualModelEvidence{
 if(raw.length<100||raw.length>20000||verifiedArtifactJsonSha!==expected.artifactJson)
   throw Error("Оригинальный числовой отчёт независимой второй модели не подтверждён по SHA-256.");
 let v:unknown;
 try{v=JSON.parse(raw);}catch{throw Error("Неверный JSON независимой нейросети.");}
 if(!validRecord(v)||
  v.schema!=="opus-public-ich-independent-two-model-consistency/v1"||
  v.status!=="two_genuine_pretrained_models_on_one_original_public_ct_not_expert_validated"||
  v.originalCtSha256!==expected.source||
  report.source.niftiSha256!==expected.source||
  firstReportSha!==expected.first||
  v.firstModelReportSha256!==firstReportSha||
  v.secondModel!=="TotalSegmentator cerebral_bleed"||
  v.secondModelTask!==150||
  v.officialWeightsRelease!=="v2.0.0-weights"||
  v.officialWeightsArchiveSha256!==expected.secondWeights||
  v.secondModelOriginalMaskSha256!==expected.secondMask||
  !Array.isArray(v.originalShapeXYZ)||
  v.originalShapeXYZ.join(",")!=="512,512,25"||
  report.source.sourceDimensionsXYZ.join(",")!=="512,512,25"||
  report.model.id!=="ianpan/ct-head-hemorrhage-detection"||
  report.model.checkpointSha256Verified!==true||
  report.readyForClinicalUse!==false||
  v.sourceHURescaleIndependentlyVerified!==false||
  v.originalReferenceLabelsArePerihematomalEdema!==true||
  v.firstModelSubtypeCandidateBoundingBoxes!==7||
  report.candidates.filter(c=>c.class==="intraparenchymal"&&c.sourceVoxelProjection!==null).length!==7||
  v.secondModelMaskPositiveVoxels!==10875||
  v.secondModelUnvalidatedMaskVolumeMl!==12.96401||
  !Array.isArray(v.secondModelSourceSliceIndices)||
  v.secondModelSourceSliceIndices.join(",")!=="9,10,11,12,13,14,16"||
  v.secondModelMaskVoxelsInsideFirstModelBoundingBoxUnion!==10862||
  v.secondModelMaskShareWithinFirstModelBounds!==0.9988046||
  Math.abs(v.secondModelMaskVoxelsInsideFirstModelBoundingBoxUnion/
    v.secondModelMaskPositiveVoxels-v.secondModelMaskShareWithinFirstModelBounds)>1e-7||
  v.secondModelNegativeDiagnosticConclusionAllowed!==false||
  v.independentRadiologistGroundTruthPresent!==false||
  v.segmentationDiceAgainstExpertMask!==null||
  v.clinicalLesionTruePositive!==null||
  v.clinicalValidation!==false||
  !Array.isArray(v.limitations)||v.limitations.length!==4||
  v.limitations.some(s=>typeof s!=="string"||s.length>350))
  throw Error("Вторая модель, источник КТ или ограничения доказательности не совпадают с настоящим прогоном.");
 return v as GenuineIchDualModelEvidence;
}
