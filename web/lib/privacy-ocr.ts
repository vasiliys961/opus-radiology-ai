import { acquireBrowserCompute } from "./browser-compute-slot.ts";
import { createPrivacyFrame,pngFromBase64,type PrivacyFrame,type PrivacyRectangle } from "./vision-privacy.ts";
import { OCR_ASSET_PREFIX } from "./privacy-ocr-assets.ts";
export type PrivacyTextRegion={rectangle:PrivacyRectangle;confidence:number};
export type PrivacyOcrResult={sha256:string;regions:PrivacyTextRegion[]};
export const OCR_TIMEOUT_MS=30_000;
/** Metadata only: recognized words never reach React state, export or logs. */
export function normalizePrivacyOcr(value:unknown,frame:PrivacyFrame):PrivacyOcrResult {
  const r=value as {sha256?:unknown;boxes?:unknown};
  if(!r||r.sha256!==frame.sha256||!Array.isArray(r.boxes)||r.boxes.length>64)throw new Error("OCR вернул несовместимый результат.");
  const regions=r.boxes.map(v=>{
    const b=v as {bbox?:{x0:number;y0:number;x1:number;y1:number};confidence:number},p=b?.bbox;
    if(!p||![p.x0,p.y0,p.x1,p.y1].every(Number.isSafeInteger)||p.x0<0||p.y0<0||p.x1>frame.width||p.y1>frame.height||
      p.x1<=p.x0||p.y1<=p.y0||!Number.isFinite(b.confidence)||b.confidence<0||b.confidence>100)throw new Error("Неверная область OCR.");
    const x=Math.max(0,p.x0-2),y=Math.max(0,p.y0-2);
    return {rectangle:{x,y,width:Math.min(frame.width,p.x1+2)-x,height:Math.min(frame.height,p.y1+2)-y},confidence:b.confidence};
  });
  return {sha256:frame.sha256,regions};
}
export async function scanPrivacyText(frame:PrivacyFrame,signal:AbortSignal):Promise<PrivacyOcrResult> {
  const release=acquireBrowserCompute("privacy-ocr");
  let worker:Worker|undefined;
  try{
    const clean=createPrivacyFrame(pngFromBase64(frame.pngBase64),frame.frameId,frame.modality,frame.redactions);
    if(clean.sha256!==frame.sha256||clean.width!==frame.width||clean.height!==frame.height)throw new Error("Копия изменена; создайте её заново.");
    if(signal.aborted)throw new DOMException("OCR отменён.","AbortError");
    worker=new Worker(OCR_ASSET_PREFIX+"host-worker.js");
    const raw=await new Promise<unknown>((resolve,reject)=>{
      let settled=false;
      const abort=()=>finish(()=>reject(new DOMException("OCR отменён.","AbortError")));
      const timer=setTimeout(()=>finish(()=>reject(new Error("OCR превысил 30 секунд. Повторите после освобождения ресурсов или проверьте кадр вручную."))),OCR_TIMEOUT_MS);
      function finish(callback:()=>void){if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener("abort",abort);callback();}
      signal.addEventListener("abort",abort,{once:true});
      worker!.onerror=()=>finish(()=>reject(new Error("Локальный OCR недоступен. Проверьте установку npm и повторите.")));
      worker!.onmessage=({data})=>{if(data?.kind==="result")finish(()=>resolve(data));else if(data?.kind==="failed"){
        const stage=["input","runtime","initialize","recognize","output"].includes(data.stage)?data.stage:"unknown";
        finish(()=>reject(new Error(`Локальный OCR не завершён (${stage}). Проверьте кадр вручную; обезличивание не подтверждено.`)));}};
      if(signal.aborted)abort();else worker!.postMessage({kind:"scan",pngBase64:clean.pngBase64,width:clean.width,height:clean.height,sha256:clean.sha256});
    });
    return normalizePrivacyOcr(raw,frame);
  }finally{
    try{if(worker){const owned=worker;await new Promise<void>(resolve=>{
      const stop=()=>{clearTimeout(timer);owned.terminate();resolve();};
      const timer=setTimeout(stop,1000);owned.onmessage=({data})=>{if(data?.kind==="stopped")stop();};owned.onerror=stop;
      try{owned.postMessage({kind:"stop"});}catch{stop();}
    });}}finally{release();}
  }
}
