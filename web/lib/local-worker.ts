/** Direct browser -> loopback. No Next.js proxy, provider calls or persisted token. */
import { assertResultBinding, parseSegmentationResult, sha256, type AnalysisPackage, type SegmentationResult } from "./analysis-package.ts";
import type { AnalysisStream } from "./analysis-stream.ts";
import { parseNiftiMask, MAX_MASK_FILE_BYTES, type LabelMask } from "./segmentation-mask.ts";

export const R231_SHA256 = "d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f";
export type WorkerSession = { endpoint: string; token: string };
export type WorkerMetrics = { device: "cpu"; inferenceSeconds: number; totalSeconds: number; peakRssMiB: number; platform: string; machine: string };
export function workerEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol!=="http:" || url.hostname!=="127.0.0.1" || !url.port || url.username || url.password || url.search || url.hash || url.pathname!=="/") {
    throw new Error("Локальный worker должен иметь адрес http://127.0.0.1:порт.");
  }
  return url.origin;
}
const id = (value: unknown): string => {
  if (typeof value!=="string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) throw new Error("Worker вернул неверный ID задания.");
  return value;
};
async function call(session: WorkerSession, path: string, init: RequestInit = {}): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(session.token)) throw new Error("Введите сессионный токен из терминала worker.");
  const response = await fetch(workerEndpoint(session.endpoint)+path, {...init, credentials:"omit", redirect:"error", cache:"no-store",
    headers:{...init.headers,Authorization:`Bearer ${session.token}`}});
  if (!response.ok) throw new Error(`Локальный worker: HTTP ${response.status}. Проверьте модель, origin, токен и свободную память.`);
  return response;
}
async function smallJson(response: Response) {
  const reader=response.body?.getReader();
  if (!reader) throw new Error("Пустой ответ worker.");
  const chunks: Uint8Array[]=[];let bytes=0;
  try {
    for (;;) {
      const next=await reader.read();if(next.done)break;
      bytes+=next.value.length;
      if(bytes>65536)throw new Error("Ответ worker превышает 64 КиБ.");
      chunks.push(next.value);
    }
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  const result=new Uint8Array(bytes);let offset=0;
  for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(result));
}
/** Enforce the advertised size while reading, before allocating the label grid. */
async function boundedMask(response: Response, length: number): Promise<ArrayBuffer> {
  const reader=response.body?.getReader();
  if(!reader) throw new Error("Пустая маска worker.");
  const buffer=new ArrayBuffer(length), target=new Uint8Array(buffer);let offset=0;
  try {
    for(;;) {
      const next=await reader.read();if(next.done)break;
      if(offset+next.value.byteLength>length)throw new Error("Размер маски worker превышает заявленный.");
      target.set(next.value,offset);offset+=next.value.byteLength;
    }
    if(offset!==length)throw new Error("Неполная маска worker.");
    return buffer;
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function checkLocalWorker(session: WorkerSession, signal?: AbortSignal): Promise<void> {
  const c=await smallJson(await call(session,"/v1/capabilities",{signal}));
  if(c.schema!=="opus-worker-capabilities/v1" || c.mode!=="local" || c.device!=="cpu" || c.dataPolicy!=="public-reference-only" || c.patientMode!==false || c.externalEgress!==false || c.concurrency!==1 || c.maxVoxels!==8388608 || c.chunkUpload?.version!==1 || c.chunkUpload?.maxChunkBytes!==262144 || c.model?.id!=="lungmask-R231" || c.model?.version!=="0.2.20" || c.model?.weightsSha256!==R231_SHA256 || c.model?.ready!==true) {
    throw new Error("Совместимый worker с проверенной Lungmask R231 недоступен. Обновите приложение и worker, проверьте зависимости и веса по руководству.");
  }
}
function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new DOMException("Задание отменено.","AbortError"));};
    const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},400);
    signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();
  });
}
export async function runLocalR231(session: WorkerSession, packet: AnalysisPackage | AnalysisStream, signal: AbortSignal,
  onStatus: (text: string)=>void): Promise<{mask: LabelMask; result: SegmentationResult; metrics: WorkerMetrics}> {
  if(packet.request.modality!=="CT")throw new Error("R231 поддерживает только КТ грудной клетки в HU.");
  await checkLocalWorker(session,signal);
  let jobId: string | null=null;
  try {
    onStatus("Создание локального задания…");
    const created=await smallJson(await call(session,"/v1/jobs",{method:"POST",signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({
      schema:"opus-worker-job/v1",dataPolicy:"public-reference-only",
      acquisition:{anatomy:"CHEST",intensity:"HU",confirmedBy:"research-operator"},request:packet.request,
    })}));
    jobId=id(created.jobId);
    onStatus("Передача объёма на этот компьютер…");
    if ("chunks" in packet) {
      let offset=0;
      for await(const chunk of packet.chunks(signal)) {
        if(chunk.byteLength<1 || chunk.byteLength>262144 || offset+chunk.byteLength>packet.byteLength) throw new Error("Неверный размер блока объёма.");
        const ack=await smallJson(await call(session,`/v1/jobs/${jobId}/input/chunks/${offset}`,{
          method:"PUT",signal,headers:{"Content-Type":"application/octet-stream"},body:chunk}));
        offset+=chunk.byteLength;
        if(ack.state!=="receiving_chunks" || ack.uploadedBytes!==offset) throw new Error("Worker не подтвердил блок объёма.");
        onStatus(`Передача объёма на этот компьютер… ${Math.floor(offset/packet.byteLength*100)}%`);
      }
      if(offset!==packet.byteLength) throw new Error("Неполный объём; инференс не запущен.");
      await call(session,`/v1/jobs/${jobId}/input/complete`,{method:"POST",signal});
    } else {
      await call(session,`/v1/jobs/${jobId}/input`,{method:"PUT",signal,headers:{"Content-Type":"application/octet-stream"},body:new Blob([packet.buffer])});
    }
    for (;;) {
      const status=await smallJson(await call(session,`/v1/jobs/${jobId}`,{signal}));
      if(status.schema!=="opus-worker-job-status/v1"||status.jobId!==jobId)throw new Error("Ответ относится к другому заданию.");
      if(status.state==="failed"||status.state==="cancelled")throw new Error("R231 не выполнила анализ. Проверьте HU, осевую геометрию, зависимости и память; это не отрицательное заключение.");
      if(status.state==="succeeded") {
        const result=parseSegmentationResult(JSON.stringify(status.result));
        if(result.model.id!=="lungmask-R231"||result.model.version!=="0.2.20"||result.model.weightsSha256!==R231_SHA256)throw new Error("Неожиданная модель результата.");
        const response=await call(session,`/v1/jobs/${jobId}/mask`,{signal});
        const length=Number(response.headers.get("content-length"));
        if(!Number.isSafeInteger(length)||length<352||length>MAX_MASK_FILE_BYTES)throw new Error("Неверный размер маски worker.");
        const buffer=await boundedMask(response,length);
        if(buffer.byteLength!==length)throw new Error("Неполная маска worker.");
        const mask=parseNiftiMask(buffer);
        assertResultBinding(result,packet.request,mask,await sha256(buffer));
        const m=status.metrics;
        if(m?.device!=="cpu" || ![m.inferenceSeconds,m.totalSeconds,m.peakRssMiB].every(v=>typeof v==="number"&&Number.isFinite(v)&&v>=0) || typeof m.platform!=="string" || typeof m.machine!=="string")throw new Error("Worker не вернул проверяемые метрики.");
        return {mask,result,metrics:m};
      }
      if(!["queued","running"].includes(status.state))throw new Error("Неизвестное состояние worker.");
      onStatus(`R231 · ${status.state==="running"?"вычисление":"очередь"} · ${Number(status.elapsedSeconds).toFixed(1)} с`);
      await pause(signal);
    }
  } finally {
    if(jobId)await call(session,`/v1/jobs/${jobId}`,{method:"DELETE",signal:AbortSignal.timeout(5000)}).catch(()=>{});
  }
}
