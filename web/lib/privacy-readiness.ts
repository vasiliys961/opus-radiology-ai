/** Local preparation status only. Never a server attestation or privacy release. */
import { PATIENT_CLOUD_REQUIREMENTS } from "./patient-cloud-policy.ts";
import { exportPrivacyJournal,type PrivacyJournal } from "./privacy-review-journal.ts";
import { MAX_PRIVACY_PIXELS,type PrivacyFrame } from "./vision-privacy.ts";
import type { PrivacyOcrResult } from "./privacy-ocr.ts";

export type PrivacyReadinessInputs={frames:readonly PrivacyFrame[];ocr:Readonly<Record<string,PrivacyOcrResult>>;
  keptText:Readonly<Record<string,string>>;busy:boolean};
/** Cheap metadata projection for rendering. Does not read/rehash/duplicate PNGs. */
export function assessPrivacyReadiness({frames,ocr,keptText,busy}:PrivacyReadinessInputs) {
  if(frames.length>4||new Set(frames.map(f=>f.frameId)).size!==frames.length)throw new Error("Неверный набор локальных копий.");
  const rows=frames.map(f=>{
    if(!/^frame-[1-4]$/.test(f.frameId)||!/^[a-f0-9]{64}$/.test(f.sha256)||!["CT","MR"].includes(f.modality)||
      !Number.isSafeInteger(f.width)||!Number.isSafeInteger(f.height)||f.width<1||f.height<1||f.width*f.height>MAX_PRIVACY_PIXELS||
      !Array.isArray(f.redactions)||f.redactions.length>32)throw new Error("Неверная привязка локальной копии.");
    const found=ocr[f.frameId],current=found?.sha256===f.sha256;
    if(current&&(!Array.isArray(found.regions)||found.regions.length>64))throw new Error("Неверный локальный статус OCR.");
    const regionCount=current?found.regions.length:null;
    const ocrState=!found?"not-run":!current?"stale":regionCount===0?"no-text-found":"text-found";
    const textAcknowledged=current&&!!regionCount&&keptText[f.frameId]===f.sha256;
    const unresolvedText=current&&!!regionCount&&!textAcknowledged;
    const textReviewed=f.pixelReviewSha256===f.sha256,visualReviewed=f.visualReviewSha256===f.sha256;
    return {frameId:f.frameId,modality:f.modality,width:f.width,height:f.height,sha256:f.sha256,
      redactionCount:f.redactions.length,ocrState,regionCount,textAcknowledged,
      textReviewed,visualReviewed,localReviewDone:textReviewed&&visualReviewed&&!unresolvedText};
  });
  const localReviewDone=rows.length>0&&!busy&&rows.every(f=>f.localReviewDone);
  return {schema:"opus-local-privacy-readiness/v1" as const,status:busy?"operation-in-progress":
    rows.length===0?"not-prepared":localReviewDone?"local-review-draft-ready":"needs-local-review",
    coverage:"sampled-frames-only" as const,localReviewDone,frames:rows,
    serverChecks:PATIENT_CLOUD_REQUIREMENTS.map(r=>({id:r.id,label:r.label,status:"not-connected" as const})),
    productionRelease:"not-implemented" as const,transmissionPermitted:false as const,deidentificationVerified:false as const};
}
/** On-demand export validates exact bounded PNG bytes and replayed review state. */
export function buildPrivacyReadinessReport(input:PrivacyReadinessInputs,journal:PrivacyJournal) {
  if(input.busy||!input.frames.length)throw new Error("Сначала подготовьте копии и завершите текущую операцию.");
  const checked=exportPrivacyJournal(journal,input.frames);
  return {...assessPrivacyReadiness(input),validation:"local-copy-sha-and-journal-checked" as const,
    journalSha256:checked.journalSha256,journalRevision:checked.journal.events.length};
}
