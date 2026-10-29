/** Offline-only preview preparation: exact PNG metadata removal, sequential
 * OCR, black-pixel masking, second OCR; NEVER grants cloud permission.
 * All stages are source-hash bound to a replayable local journal.
 */
import {createPrivacyFrame,pngFromBase64,type PrivacyFrame} from "./vision-privacy.ts";
import {redactPrivacyRegions} from "./vision-privacy-browser.ts";
import {scanPrivacyText,type PrivacyOcrResult} from "./privacy-ocr.ts";
import {appendPrivacyEvent,createPrivacyJournal,type PrivacyJournal} from "./privacy-review-journal.ts";

export type AutomaticPrivacyPreparation={
 frames:PrivacyFrame[];ocr:Record<string,PrivacyOcrResult>;
 journal:PrivacyJournal;unresolved:number;redacted:number;
};
export async function autoPrepareVisionPrivacy(
 previews:readonly (string|undefined)[], modality:"CT"|"MR"|"CR"|"DX",
 signal:AbortSignal,onProgress:(s:string)=>void=()=>{},
 options?:{
  scan:(frame:PrivacyFrame,signal:AbortSignal)=>Promise<PrivacyOcrResult>;
  redact:(frame:PrivacyFrame,regions:PrivacyFrame["redactions"])=>Promise<PrivacyFrame>;
 },
):Promise<AutomaticPrivacyPreparation>{
 if(previews.length===0||previews.length>4||previews.some(p=>!p?.startsWith("data:image/png;base64,")))
  throw Error("Не все исходные PNG для локальной подготовки доступны.");
 const initial=previews.map((url,i)=>
  createPrivacyFrame(pngFromBase64(url!.split(",")[1]),"frame-"+(i+1),modality));
 let journal=createPrivacyJournal(initial,crypto.randomUUID(),new Date().toISOString());
 const frames:PrivacyFrame[]=[];const ocr:Record<string,PrivacyOcrResult>={};
 let redacted=0,unresolved=0;
 const write=(f:PrivacyFrame,action:Parameters<typeof appendPrivacyEvent>[3])=>{
  journal=appendPrivacyEvent(journal,f.frameId,f.sha256,action,new Date().toISOString());
 };
 const scan=options?.scan??scanPrivacyText;
 const redact=options?.redact??redactPrivacyRegions;
 for(const [index,original] of initial.entries()){
  if(signal.aborted)throw new DOMException("Подготовка остановлена.","AbortError");
  let f=original;
  onProgress("Локальный OCR и очистка PNG "+(index+1)+" из "+initial.length);
  write(f,{kind:"ocr-started"});
  let result:PrivacyOcrResult;
  try{
   result=await scan(f,signal);
   if(result.sha256!==f.sha256)throw Error("OCR не связан с точной копией PNG.");
   if(result.regions.length>64)throw Error("Слишком много OCR-областей.");
   write(f,{kind:"ocr-completed",regionCount:result.regions.length});
  }catch(e){
   write(f,{kind:signal.aborted?"ocr-cancelled":"ocr-failed"});
   throw e;
  }
  if(result.regions.length>0&&result.regions.length<=32){
   const before=f;
   const rectangles=result.regions.map(r=>r.rectangle);
   f=await redact(f,rectangles);
   if(f.frameId!==before.frameId||f.sha256===before.sha256||
      f.redactions.length!==rectangles.length)
    throw Error("Скрытие не подтвердило изменения пикселей.");
   write(before,{kind:"redacted",rectangles,nextSha256:f.sha256});
   redacted+=rectangles.length;
   write(f,{kind:"ocr-started"});
   try{
    result=await scan(f,signal);
    if(result.sha256!==f.sha256)throw Error("Повторный OCR не соответствует копии.");
    write(f,{kind:"ocr-completed",regionCount:result.regions.length});
   }catch(e){
    write(f,{kind:signal.aborted?"ocr-cancelled":"ocr-failed"});
    throw e;
   }
  }
  if(result.regions.length>0)unresolved++;
  ocr[f.frameId]=result;
  frames.push(f);
 }
 if(signal.aborted)throw new DOMException("Подготовка остановлена.","AbortError");
 return {frames,ocr,journal,unresolved,redacted};
}
