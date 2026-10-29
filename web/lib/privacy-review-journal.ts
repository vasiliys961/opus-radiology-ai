/** Bounded local declarations, not authenticated audit or de-identification proof. */
import { sha256 } from "@noble/hashes/sha2.js";
import { buildVisionPrivacyPacket,createPrivacyFrame,pngFromBase64,validatePrivacyRectangle,MAX_PRIVACY_PIXELS,
  type PrivacyFrame,type PrivacyRectangle } from "./vision-privacy.ts";

export const MAX_PRIVACY_EVENTS=128;
export const MAX_PRIVACY_BUNDLE_BYTES=12*1024*1024;
type FrameBinding={frameId:string;modality:"CT"|"MR"|"CR"|"DX";width:number;height:number;sha256:string};
export type PrivacyAction=
  | {kind:"redacted";nextSha256:string;rectangles:PrivacyRectangle[]}
  | {kind:"ocr-started"}
  | {kind:"ocr-completed";regionCount:number}
  | {kind:"ocr-cancelled"|"ocr-failed"}
  | {kind:"text-retained"}
  | {kind:"copy-restored"}
  | {kind:"review-set";review:"pixel"|"visual";checked:boolean};
export type PrivacyEvent={revision:number;declaredAt:string;frameId:string;sha256:string;action:PrivacyAction};
export type PrivacyJournal={schema:"opus-privacy-journal/v1"|"opus-privacy-journal/v2";sessionId:string;createdAt:string;
  actor:"local-unverified";initialFrames:FrameBinding[];events:PrivacyEvent[]};
type FrameState=FrameBinding & {redactions:PrivacyRectangle[];pixelReviewSha256:string|null;
  visualReviewSha256:string|null;ocrRunning:boolean;regionCount:number|null;textRetained:boolean};
const digest=(value:unknown)=>Array.from(sha256(new TextEncoder().encode(JSON.stringify(value))),b=>b.toString(16).padStart(2,"0")).join("");
function hash(value:string):string {
  if(typeof value!=="string"||!/^[a-f0-9]{64}$/.test(value))throw new Error("Неверная привязка SHA журнала.");return value;
}
function time(value:string):string {
  if(typeof value!=="string"||value.length!==24||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)
    throw new Error("Неверное заявленное время журнала.");return value;
}
function binding(f:FrameBinding):FrameBinding {
  if(!/^frame-[1-4]$/.test(f.frameId)||!["CT","MR","CR","DX"].includes(f.modality)||
    !Number.isSafeInteger(f.width)||!Number.isSafeInteger(f.height)||f.width<1||f.height<1||f.width*f.height>MAX_PRIVACY_PIXELS)
    throw new Error("Неверная привязка кадра журнала.");
  return {frameId:f.frameId,modality:f.modality,width:f.width,height:f.height,sha256:hash(f.sha256)};
}
function apply(f:FrameState,input:PrivacyAction):PrivacyAction {
  if(f.ocrRunning&&!["ocr-completed","ocr-cancelled","ocr-failed"].includes(input.kind))
    throw new Error("Сначала дождитесь завершения OCR или отмените его.");
  switch(input.kind){
    case "copy-restored":
      f.pixelReviewSha256=f.visualReviewSha256=null;f.regionCount=null;f.textRetained=false;
      return {kind:input.kind};
    case "redacted":{
      if(!Array.isArray(input.rectangles)||!input.rectangles.length||f.redactions.length+input.rectangles.length>32)
        throw new Error("Лимит областей журнала: 32 на кадр.");
      const rectangles=input.rectangles.map(r=>validatePrivacyRectangle(r,f.width,f.height));
      f.sha256=hash(input.nextSha256);f.redactions.push(...rectangles);
      f.pixelReviewSha256=f.visualReviewSha256=null;f.regionCount=null;f.textRetained=false;
      return {kind:input.kind,nextSha256:f.sha256,rectangles};
    }
    case "ocr-started":
      f.ocrRunning=true;f.regionCount=null;f.textRetained=false;f.pixelReviewSha256=f.visualReviewSha256=null;
      return {kind:input.kind};
    case "ocr-completed":
      if(!f.ocrRunning||!Number.isSafeInteger(input.regionCount)||input.regionCount<0||input.regionCount>64)
        throw new Error("Неверный результат OCR в журнале.");
      f.ocrRunning=false;f.regionCount=input.regionCount;return {kind:input.kind,regionCount:input.regionCount};
    case "ocr-cancelled":case "ocr-failed":
      if(!f.ocrRunning)throw new Error("OCR не запущен в журнале.");
      f.ocrRunning=false;return {kind:input.kind};
    case "text-retained":
      if(!f.regionCount)throw new Error("Нет найденных надписей для ручной отметки.");
      f.textRetained=true;return {kind:input.kind};
    case "review-set":
      if(!["pixel","visual"].includes(input.review)||typeof input.checked!=="boolean")throw new Error("Неверная ручная отметка.");
      if(input.checked&&f.regionCount&&!f.textRetained)throw new Error("Сначала скройте найденные надписи или проверьте их вручную.");
      f[input.review==="pixel"?"pixelReviewSha256":"visualReviewSha256"]=input.checked?f.sha256:null;
      return {kind:input.kind,review:input.review,checked:input.checked};
    default:throw new Error("Неизвестное действие журнала.");
  }
}
/** Replay and project known fields only; no PNG, recognized words, UIDs or error text. */
function replay(input:PrivacyJournal):{journal:PrivacyJournal;states:FrameState[]} {
  if(!["opus-privacy-journal/v1","opus-privacy-journal/v2"].includes(input.schema)||input.actor!=="local-unverified"||
    typeof input.sessionId!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.sessionId)||
    !Array.isArray(input.initialFrames)||input.initialFrames.length<1||input.initialFrames.length>4||
    !Array.isArray(input.events)||input.events.length>MAX_PRIVACY_EVENTS)
    throw new Error("Неверный или слишком большой локальный журнал.");
  const initialFrames=input.initialFrames.map(binding);
  if(new Set(initialFrames.map(f=>f.frameId)).size!==initialFrames.length)throw new Error("Повтор кадра журнала.");
  const states:FrameState[]=initialFrames.map(f=>({...f,redactions:[],pixelReviewSha256:null,visualReviewSha256:null,
    ocrRunning:false,regionCount:null,textRetained:false}));
  const events=input.events.map((e,i)=>{
    const f=states.find(f=>f.frameId===e.frameId);
    if(!f||e.revision!==i+1||hash(e.sha256)!==f.sha256)throw new Error("История не совпадает с кадром или порядком действий.");
    if(states.some(s=>s.ocrRunning&&s.frameId!==f.frameId))throw new Error("Сначала завершите OCR текущего кадра.");
    if(e.action.kind==="copy-restored"&&input.schema!=="opus-privacy-journal/v2")throw new Error("Восстановление требует версии v2.");
    const declaredAt=time(e.declaredAt),sha256=f.sha256,action=apply(f,e.action);
    return {revision:i+1,declaredAt,frameId:f.frameId,sha256,action};
  });
  return {journal:{schema:input.schema,sessionId:input.sessionId,createdAt:time(input.createdAt),actor:input.actor,initialFrames,events},states};
}
export function createPrivacyJournal(frames:readonly PrivacyFrame[],sessionId:string,createdAt:string):PrivacyJournal {
  if(frames.some(f=>f.redactions.length||f.pixelReviewSha256!==null||f.visualReviewSha256!==null))
    throw new Error("Новый журнал начинается с непроверенных копий без скрытых областей.");
  return replay({schema:"opus-privacy-journal/v1",sessionId,createdAt,actor:"local-unverified",initialFrames:frames.map(binding),events:[]}).journal;
}
export function appendPrivacyEvent(journal:PrivacyJournal,frameId:string,sha256:string,action:PrivacyAction,declaredAt:string):PrivacyJournal {
  const current=replay(journal).journal;
  // Reserve a terminal entry before starting OCR; capacity can never prevent its cleanup record.
  if(current.events.length>=MAX_PRIVACY_EVENTS-(action.kind==="ocr-started"?1:0))
    throw new Error("Лимит журнала: 128 действий. Сохраните журнал и создайте копии заново; проверки начнутся заново.");
  return replay({...current,schema:action.kind==="copy-restored"?"opus-privacy-journal/v2":current.schema,
    events:[...current.events,{revision:current.events.length+1,declaredAt,frameId,sha256,action}]}).journal;
}
export function exportPrivacyJournal(input:PrivacyJournal,frames:readonly PrivacyFrame[]) {
  const {journal,states}=replay(input);
  if(states.some(f=>f.ocrRunning))throw new Error("Сначала завершите или отмените OCR.");
  const projection=(f:PrivacyFrame|FrameState)=>({...binding(f),redactions:f.redactions.map(r=>validatePrivacyRectangle(r,f.width,f.height)),
    pixelReviewSha256:f.pixelReviewSha256,visualReviewSha256:f.visualReviewSha256});
  if(frames.length!==states.length||frames.some((f,i)=>{
    const clean=createPrivacyFrame(pngFromBase64(f.pngBase64),f.frameId,f.modality,f.redactions);
    return clean.sha256!==f.sha256||clean.width!==f.width||clean.height!==f.height||digest(projection(f))!==digest(projection(states[i]));
  }))
    throw new Error("Копии и ручные отметки не совпадают с журналом. Создайте копии заново.");
  return {schema:journal.schema==="opus-privacy-journal/v2"?"opus-privacy-journal-export/v2" as const:"opus-privacy-journal-export/v1" as const,
    journal,journalSha256:digest(journal),status:"local-unverified" as const,transmissionPermitted:false as const};
}
export function buildPrivacyReviewBundle(frames:readonly PrivacyFrame[],journal:PrivacyJournal,packetId:string) {
  const candidate=buildVisionPrivacyPacket(frames,packetId),review=exportPrivacyJournal(journal,candidate.frames);
  return {schema:journal.schema==="opus-privacy-journal/v2"?"opus-vision-privacy-review/v2" as const:"opus-vision-privacy-review/v1" as const,candidate,review};
}

class PrivacyRestoreError extends Error {}
/** Explicit local file only. No imported mark is treated as current human review. */
export function restorePrivacyReviewBundle(text:string,sourceFrames:readonly PrivacyFrame[],
  current:{journal:PrivacyJournal;frames:readonly PrivacyFrame[]}|null,declaredAt:string):{journal:PrivacyJournal;frames:PrivacyFrame[]} {
  try{
    if(typeof text!=="string"||text.length>MAX_PRIVACY_BUNDLE_BYTES)
      throw new PrivacyRestoreError("Пакет ограничен 12 МиБ. Выберите файл копий с журналом.");
    const input=JSON.parse(text);
    const version=input.schema==="opus-vision-privacy-review/v1"?"v1":input.schema==="opus-vision-privacy-review/v2"?"v2":null;
    if(!version)throw new PrivacyRestoreError("Нужен пакет копий с журналом v1/v2; отдельный журнал или кандидат не подходит.");
    const c=input.candidate,r=input.review;
    if(c.schema!=="opus-vision-privacy/v1"||c.status!=="local-review-draft"||c.coverage!=="sampled-frames-only"||
      c.metadataPolicy!=="pixel-only-no-DICOM"||c.transmissionPermitted!==false||c.deidentificationVerified!==false||
      r.schema!==`opus-privacy-journal-export/${version}`||r.status!=="local-unverified"||r.transmissionPermitted!==false||
      r.journal.schema!==`opus-privacy-journal/${version}`)
      throw new PrivacyRestoreError("Версия или приватность пакета не совпадают с локальным черновиком.");
    const candidate=buildVisionPrivacyPacket(c.frames,c.packetId);
    const imported=exportPrivacyJournal(r.journal,candidate.frames);
    if(hash(r.journalSha256)!==imported.journalSha256)throw new PrivacyRestoreError("SHA журнала не совпадает. Текущая работа сохранена.");
    // Validate the actual currently loaded initial copies, not a filename or imported source claim.
    const source=createPrivacyJournal(sourceFrames,imported.journal.sessionId,declaredAt);
    exportPrivacyJournal(source,sourceFrames);
    if(digest(source.initialFrames)!==digest(imported.journal.initialFrames))
      throw new PrivacyRestoreError("Пакет относится к другим выбранным кадрам, окну или порядку. Загрузите тот же исходный набор.");
    if(current){
      const previous=exportPrivacyJournal(current.journal,current.frames).journal;
      if(digest(previous.initialFrames)!==digest(source.initialFrames))throw new PrivacyRestoreError("Текущая сессия относится к другим кадрам.");
      if(previous.events.length&&(previous.sessionId!==imported.journal.sessionId||previous.createdAt!==imported.journal.createdAt||
        imported.journal.events.length<previous.events.length||digest(imported.journal.events.slice(0,previous.events.length))!==digest(previous.events)))
        throw new PrivacyRestoreError("Пакет старее текущей истории или содержит другую ветку. Сначала сохраните текущую работу; она не заменена.");
    }
    if(imported.journal.events.length+candidate.frames.length*3>MAX_PRIVACY_EVENTS)
      throw new PrivacyRestoreError("В журнале нет места для восстановления и повторных проверок. Сохраните файл и начните новые копии.");
    let journal=imported.journal;
    const frames=candidate.frames.map(f=>{
      journal=appendPrivacyEvent(journal,f.frameId,f.sha256,{kind:"copy-restored"},declaredAt);
      return {...f,pixelReviewSha256:null,visualReviewSha256:null};
    });
    return {journal,frames};
  }catch(e){
    if(e instanceof PrivacyRestoreError)throw e;
    // JSON.parse/type errors may contain file fragments. Never echo them to UI or logs.
    throw new PrivacyRestoreError("Пакет повреждён или не совпадает с копиями/историей. Текущая работа сохранена.");
  }
}
