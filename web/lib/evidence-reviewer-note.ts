/** Bounded local text draft, distinct from model output and clinical sign-off. */
import { sha256 } from "@noble/hashes/sha2.js";
import { normalizeEvidenceReviewHistory, type EvidenceReviewHistory, type ReviewedEvidence } from "./evidence-review-history.ts";

export const MAX_NOTE_CHARS=4_000, MAX_NOTE_VERSIONS=32, MAX_NOTE_JSON_BYTES=512_000;
export type ReviewerNoteVersion={revision:number;reviewRevision:number;reviewSha256:string;text:string;at:string;actor:"local-unverified-reviewer"};
export type ReviewerNote={schema:"opus-reviewer-note/v1";clinicalStatus:"unverified_research_draft";provenance:"local-unverified";
  binding:EvidenceReviewHistory["binding"];versions:ReviewerNoteVersion[]};
export type EvidenceWithNote=ReviewedEvidence & {reviewerNote?:ReviewerNote};
const object=(v:unknown):Record<string,unknown>=>{
  if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("Неверный объект заметки проверяющего.");
  return v as Record<string,unknown>;
};
function digest(history:EvidenceReviewHistory,revision:number):string {
  const bytes=new TextEncoder().encode(JSON.stringify({binding:history.binding,events:history.events.slice(0,revision)}));
  return Array.from(sha256(bytes),b=>b.toString(16).padStart(2,"0")).join("");
}
const time=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;

export function normalizeReviewerNote(value:unknown,evidence:ReviewedEvidence):ReviewerNote {
  const r=object(value),b=object(r.binding),history=normalizeEvidenceReviewHistory(evidence.reviewHistory,evidence);
  if(r.schema!=="opus-reviewer-note/v1"||r.clinicalStatus!=="unverified_research_draft"||r.provenance!=="local-unverified"||
    !Array.isArray(r.versions)||r.versions.length>MAX_NOTE_VERSIONS)throw new Error("Неподдерживаемый черновик заметки.");
  if(Object.entries(history.binding).some(([key,v])=>b[key]!==v))throw new Error("Заметка относится к другому источнику, маске или модели.");
  const hashes=new Map<number,string>();
  let previousReviewRevision=0;
  const versions=r.versions.map((value,i):ReviewerNoteVersion=>{
    const v=object(value);
    if(v.revision!==i+1||typeof v.text!=="string"||v.text.length>MAX_NOTE_CHARS||!time(v.at)||v.actor!=="local-unverified-reviewer"||
      typeof v.reviewRevision!=="number"||!Number.isSafeInteger(v.reviewRevision)||v.reviewRevision<previousReviewRevision||v.reviewRevision>history.events.length)
      throw new Error("Неверная версия заметки или отсутствует соответствующая история проверки.");
    previousReviewRevision=v.reviewRevision;
    if(!hashes.has(v.reviewRevision))hashes.set(v.reviewRevision,digest(history,v.reviewRevision));
    if(v.reviewSha256!==hashes.get(v.reviewRevision))throw new Error("Заметка привязана к другой последовательности проверки.");
    return {revision:i+1,reviewRevision:v.reviewRevision,reviewSha256:v.reviewSha256 as string,text:v.text,at:v.at,actor:"local-unverified-reviewer"};
  });
  return {schema:"opus-reviewer-note/v1",clinicalStatus:"unverified_research_draft",provenance:"local-unverified",binding:history.binding,versions};
}

export function saveReviewerNote(evidence:EvidenceWithNote,text:string,at:string):EvidenceWithNote {
  if(typeof text!=="string"||text.length>MAX_NOTE_CHARS||!time(at))throw new Error("Заметка ограничена 4000 символами; проверьте время устройства.");
  const history=normalizeEvidenceReviewHistory(evidence.reviewHistory,evidence);
  const note=evidence.reviewerNote?normalizeReviewerNote(evidence.reviewerNote,evidence):
    {schema:"opus-reviewer-note/v1" as const,clinicalStatus:"unverified_research_draft" as const,provenance:"local-unverified" as const,binding:history.binding,versions:[]};
  const last=note.versions[note.versions.length-1],reviewSha256=digest(history,history.events.length);
  if((!last&&text==="")||(last?.text===text&&last.reviewSha256===reviewSha256))return evidence;
  if(note.versions.length>=MAX_NOTE_VERSIONS)throw new Error("Достигнут лимит 32 версий заметки. Сохраните историю; текущая заметка сохранена.");
  const version:ReviewerNoteVersion={revision:note.versions.length+1,reviewRevision:history.events.length,reviewSha256,text,at,actor:"local-unverified-reviewer"};
  return {...evidence,reviewerNote:{...note,versions:[...note.versions,version]}};
}

export function reviewerNoteNeedsRecheck(evidence:EvidenceWithNote):boolean {
  const last=evidence.reviewerNote?.versions[evidence.reviewerNote.versions.length-1];
  if(!last)return false;
  const history=normalizeEvidenceReviewHistory(evidence.reviewHistory,evidence);
  return last.reviewRevision!==history.events.length||last.reviewSha256!==digest(history,history.events.length);
}

export function restoreReviewerNote(evidence:EvidenceWithNote,raw:string):EvidenceWithNote {
  if(raw.length>MAX_NOTE_JSON_BYTES||new TextEncoder().encode(raw).byteLength>MAX_NOTE_JSON_BYTES)throw new Error("Файл заметки превышает 512 КБ.");
  let value:unknown;try{value=JSON.parse(raw);}catch{throw new Error("Файл заметки не содержит корректный JSON.");}
  const note=normalizeReviewerNote(value,evidence),previous=evidence.reviewerNote?.versions??[];
  if(note.versions.length<previous.length||previous.some((v,i)=>JSON.stringify(v)!==JSON.stringify(note.versions[i])))
    throw new Error("Заметка не продолжает текущую историю версий; старый или расходящийся файл отклонён.");
  return {...evidence,reviewerNote:note};
}
