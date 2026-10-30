/** Sanitized, source-bound CLN tumor evidence for Gemini-independent / Opus review.
 * Never send raw DICOM, source digests, original filenames or 3-D coordinates.
 */
export type SanitizedClnTumorEvidence={
  schema:"opus-sanitized-cln-lung-tumor/v1";
  task:"lung_tumor";
  status:"completed";
  candidateCount:number;
  candidateVolumeMl:number|null;
  researchOnly:true;
  clinicalValidation:false;
  negativeDiagnosisPermitted:false;
  sourceIdentifiersSent:false;
  sourcePixelsSent:false;
};
export function sanitizeClnTumorReport(report:unknown,sourceNiftiSha256:string):SanitizedClnTumorEvidence{
  if(!report||typeof report!=="object"||Array.isArray(report))
    throw Error("invalid_CLN_report");
  const r=report as Record<string,unknown>;
  if(r.schema!=="opus-original-CLN-native-DICOM-lung-tumor/v1"||
     r.originalModelForwardCompleted!==true||
     r.sourceDicomGeometryAccepted!==true||
     r.originalDicomSopRegistrationVerified!==false||
     r.researchOnly!==true||r.clinicalValidation!==false||
     r.negativeDiagnosisPermitted!==false||
     r.sourceImageFilesUploadedToCloud!==false||
     r.candidateListTruncated!==false||
     !/^[a-f0-9]{64}$/.test(sourceNiftiSha256)||
     r.sourceDicomNiftiSha256!==sourceNiftiSha256||
     typeof r.checkpointSha256!=="string"||!/^[a-f0-9]{64}$/.test(r.checkpointSha256))
    throw Error("unverified_or_unbound_CLN_inference");
  if(!Number.isSafeInteger(r.candidateCount)||Number(r.candidateCount)<0||
     Number(r.candidateCount)>100000||!Array.isArray(r.nativeCandidates)||
     r.nativeCandidates.length!==r.candidateCount)
    throw Error("invalid_CLN_candidate_count");
  let sum=0;
  for(const value of r.nativeCandidates){
    if(!value||typeof value!=="object"||Array.isArray(value))
      throw Error("invalid_CLN_candidate");
    const v=(value as Record<string,unknown>).candidateVolumeMl;
    if(typeof v!=="number"||!Number.isFinite(v)||v<0||v>100000)
      throw Error("invalid_CLN_candidate_volume");
    sum+=v;
  }
  if(sum>100000)throw Error("CLN_candidate_volume_exceeds_limit");
  return {schema:"opus-sanitized-cln-lung-tumor/v1",task:"lung_tumor",
    status:"completed",candidateCount:r.candidateCount as number,
    candidateVolumeMl:Math.round(sum*1000)/1000,
    researchOnly:true,clinicalValidation:false,negativeDiagnosisPermitted:false,
    sourceIdentifiersSent:false,sourcePixelsSent:false};
}
export function validateSanitizedClnEvidence(value:unknown):value is SanitizedClnTumorEvidence{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return Object.keys(v).sort().join(",")===
    ["schema","task","status","candidateCount","candidateVolumeMl","researchOnly",
     "clinicalValidation","negativeDiagnosisPermitted","sourceIdentifiersSent","sourcePixelsSent"].sort().join(",")&&
    v.schema==="opus-sanitized-cln-lung-tumor/v1"&&v.task==="lung_tumor"&&
    v.status==="completed"&&v.researchOnly===true&&v.clinicalValidation===false&&
    v.negativeDiagnosisPermitted===false&&v.sourceIdentifiersSent===false&&
    v.sourcePixelsSent===false&&Number.isSafeInteger(v.candidateCount)&&
    Number(v.candidateCount)>=0&&Number(v.candidateCount)<=100000&&
    typeof v.candidateVolumeMl==="number"&&Number.isFinite(v.candidateVolumeMl)&&
    v.candidateVolumeMl>=0&&v.candidateVolumeMl<=100000;
}
