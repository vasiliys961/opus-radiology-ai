/** Source-native CLN candidates -> exact selected DICOM slice indices.
 * Called ONLY after the caller verifies the uploaded NIfTI bytes (SHA-256)
 * and NIfTI/DICOM physical affine; never treats model regions as diagnoses.
 */
import {CLN_ORIGINAL_CHECKPOINT_SHA256,type ClnReport} from "./cln-native-worker.ts";
/** Exact hash/affine/SOP-bound local-only candidate locations; never forward UID to LLM. */
export type ClnVerifiedLocalEvidence={
 sourceNiftiSha256:string;
 dimensions:[number,number,number];
 candidates:ClnSliceCandidate[];
};
export type ClnSliceCandidate={
  componentId:number;
  candidateVolumeMl:number;
  sourceVoxelCentroidIJK:[number,number,number];
  sliceIndex:number;
  sopInstanceUid:string;
};
export function bindOriginalClnCandidates(
 report:ClnReport,dimensions:readonly [number,number,number],
 sopInstanceUids:readonly string[],
):ClnSliceCandidate[]{
 if(report.schema!=="opus-original-cln-upload-result/v1"||
    report.realOriginalModelForwardCompleted!==true||
    report.checkpointSha256!==CLN_ORIGINAL_CHECKPOINT_SHA256||
    !/^[a-f0-9]{64}$/.test(report.sourceNiftiSha256)||
    report.researchOnly!==true||report.clinicalValidation!==false||
    report.negativeDiagnosisPermitted!==false||
    !Number.isSafeInteger(report.candidateCount)||report.candidateCount<0||
    report.candidateCount>250||!Array.isArray(report.nativeCandidates)||
    report.nativeCandidates.length!==report.candidateCount)
   throw Error("CLN original report is not source-verified");
 if(dimensions.length!==3||dimensions.some((n,i)=>!Number.isSafeInteger(n)||n<1||n>[512,512,300][i])||
    sopInstanceUids.length!==dimensions[2]||
    sopInstanceUids.some(uid=>typeof uid!=="string"||!uid.trim())||
    new Set(sopInstanceUids).size!==sopInstanceUids.length)
   throw Error("CLN DICOM slice geometry/identity is incomplete");
 const seen=new Set<number>();
 return report.nativeCandidates.map((candidate)=>{
  const c=candidate as Record<string,unknown>;
  const id=c.modelComponentId,ijk=c.sourceVoxelCentroidIJK,vol=c.candidateVolumeMl;
  if(!Number.isSafeInteger(id)||Number(id)<1||seen.has(Number(id))||
     typeof vol!=="number"||!Number.isFinite(vol)||vol<=0||vol>100000||
     !Array.isArray(ijk)||ijk.length!==3||
     ijk.some((v,i)=>typeof v!=="number"||!Number.isFinite(v)||v<0||v>dimensions[i]-1))
    throw Error("CLN candidate not inside native DICOM-aligned source");
  seen.add(Number(id));
  const sliceIndex=Math.round(ijk[2]);
  return {
   componentId:id as number,candidateVolumeMl:vol,
   sourceVoxelCentroidIJK:ijk as [number,number,number],
   sliceIndex,sopInstanceUid:sopInstanceUids[sliceIndex],
  };
 });
}
