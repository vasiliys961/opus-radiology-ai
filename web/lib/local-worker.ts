/** Direct browser -> loopback. No Next.js proxy, provider calls or persisted token. */
import { assertResultBinding, parseSegmentationResult, sha256, type AnalysisPackage, type SegmentationResult } from "./analysis-package.ts";
import type { AnalysisStream } from "./analysis-stream.ts";
import { parseNiftiMask, MAX_MASK_FILE_BYTES, type LabelMask } from "./segmentation-mask.ts";
import { buildSegmentationEvidence, type SegmentationEvidence } from "./segmentation-evidence.ts";

export const R231_SHA256 = "d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f";
export type WorkerSession = { endpoint: string; token: string };
export type ResourcePreflight = {availableRamBytes: number; requiredRamBytes: number; availableDiskBytes: number; requiredDiskBytes: number; guardDecision: string; runtimeAvailableRamBytes?: number};
export type WorkerMetrics = { device: "cpu"; inferenceSeconds: number; totalSeconds: number; peakRssMiB: number; platform: string; machine: string;
  preflight?: ResourcePreflight; guardDecision?: string; resourceProfile?: "safe" | "balanced"; threads?: number; interOpThreads?: number;
  inferenceImplementation?:"full-ct-streamed-r231/v2";torchVersion?:string };
export class LocalWorkerError extends Error {
  code: string;
  preflight?: ResourcePreflight;
  constructor(code: string, message: string, preflight?: ResourcePreflight) {
    super(message);this.name="LocalWorkerError";this.code=code;this.preflight=preflight;
  }
}
export function resourcePreflight(value: unknown): ResourcePreflight | undefined {
  if (!value || typeof value!=="object")return;
  const p=value as ResourcePreflight;
  if (![p.availableRamBytes,p.requiredRamBytes,p.availableDiskBytes,p.requiredDiskBytes].every(n=>Number.isSafeInteger(n)&&n>=0)
    || !["allow","reject-memory","reject-disk","reject-model-budget"].includes(p.guardDecision))return;
  return {availableRamBytes:p.availableRamBytes,requiredRamBytes:p.requiredRamBytes,availableDiskBytes:p.availableDiskBytes,
    requiredDiskBytes:p.requiredDiskBytes,guardDecision:p.guardDecision,
    ...(typeof p.runtimeAvailableRamBytes==="number"&&Number.isSafeInteger(p.runtimeAvailableRamBytes)&&p.runtimeAvailableRamBytes>=0?{runtimeAvailableRamBytes:p.runtimeAvailableRamBytes}:{})};
}
export function workerFailure(detail: unknown, status: number): LocalWorkerError {
  const d=detail&&typeof detail==="object"?detail as {code?:unknown;preflight?:unknown}:undefined;
  const code=typeof d?.code==="string"?d.code:typeof detail==="string"?detail:"worker_http_error";
  const p=resourcePreflight(d?.preflight);
  const gib=(n:number)=>(n/1024**3).toFixed(2);
  const messages: Record<string,string>={
    insufficient_memory:p?`Недостаточно RAM: доступно ${gib(p.availableRamBytes)} ГиБ, требуется ${gib(p.requiredRamBytes)} ГиБ. Закройте лишние вкладки браузера, редакторы и локальные модели, затем нажмите «Повторить R231».`:"Недостаточно RAM. Освободите память и повторите R231.",
    insufficient_disk:p?`Недостаточно места для временных файлов: доступно ${gib(p.availableDiskBytes)} ГиБ, требуется ${gib(p.requiredDiskBytes)} ГиБ. Освободите место на диске и повторите R231.`:"Недостаточно места на диске. Освободите место и повторите R231.",
    model_memory_budget_exceeded:"Задание превышает безопасный бюджет процесса R231. Используйте явно ограниченный исследовательский фрагмент; лимит не повышается автоматически.",
    model_not_ready:"Модель R231 недоступна: проверьте веса и закреплённые версии зависимостей в .venv-lungmask, затем перезапустите worker.",
    model_not_installed_or_unverified:"Модель R231 недоступна: проверьте веса и зависимости, затем перезапустите worker.",
    unauthorized:"Неверный сессионный токен. Введите токен текущего worker и повторите R231.",
    origin_or_host_denied:"Worker отклонил origin/адрес. Проверьте точный адрес вкладки и параметр --origin, затем перезапустите worker.",
    worker_busy_delete_previous_job:"Worker занят предыдущим заданием. Отмените его или дождитесь завершения, затем повторите R231.",
    job_not_found:"Задание уже удалено или истёк срок хранения. Запустите новое задание при необходимости.",
    memory_pressure:`R231 остановлена для защиты системы: доступная RAM упала ниже резерва.${p?` Доступно ${gib(p.runtimeAvailableRamBytes??p.availableRamBytes)} ГиБ; для нового запуска требуется ${gib(p.requiredRamBytes)} ГиБ.`:""} Освободите память и повторите R231. Это не отрицательное медицинское заключение.`,
    rss_limit:"R231 остановлена: процесс превысил безопасный бюджет RAM. Повторите с меньшей явно выбранной исследовательской серией; увеличение лимита автоматически запрещено.",
    timeout:"Превышено время локального задания. Проверьте нагрузку компьютера и повторите R231.",
    input_write_failed:"Не удалось записать временный объём. Проверьте свободное место и права доступа, затем повторите R231.",
  };
  const known=Object.hasOwn(messages,code);
  const message=known?messages[code]:(status===401?messages.unauthorized:status===403?messages.origin_or_host_denied:
    `Локальный worker: HTTP ${status}. Проверьте совместимость приложения и worker, зависимости и выбранную серию; результат анализа не получен.`);
  return new LocalWorkerError(known?code:status===401?"unauthorized":status===403?"origin_or_host_denied":"worker_http_error",message,p);
}
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
export async function call(session: WorkerSession, path: string, init: RequestInit = {}): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(session.token)) throw new Error("Введите сессионный токен из терминала worker.");
  const endpoint=workerEndpoint(session.endpoint);
  let response: Response;
  try {
    response = await fetch(endpoint+path, {...init, credentials:"omit", redirect:"error", cache:"no-store",
      headers:{...init.headers,Authorization:`Bearer ${session.token}`}});
  } catch(cause) {
    if(init.signal?.aborted)throw cause;
    throw new LocalWorkerError("connection_or_cors","Нет связи с локальным worker. Проверьте его запуск и --origin. Браузер может скрыть HTTP-ответ при запрете CORS; повторите после исправления адреса/origin.");
  }
  if (!response.ok) {
    const payload=await smallJson(response).catch(()=>null);
    throw workerFailure(payload?.detail,response.status);
  }
  return response;
}
export async function smallJson(response: Response) {
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
export async function boundedMask(response: Response, length: number): Promise<ArrayBuffer> {
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
export async function checkLocalWorker(session: WorkerSession, signal?: AbortSignal): Promise<"safe" | "balanced" | undefined> {
  const c=await smallJson(await call(session,"/v1/capabilities",{signal}));
  if(c.model?.ready===false)throw workerFailure({code:"model_not_ready"},503);
  if(c.schema!=="opus-worker-capabilities/v1" || c.mode!=="local" || c.device!=="cpu" || c.dataPolicy!=="public-reference-only" || c.patientMode!==false || c.externalEgress!==false || c.concurrency!==1 || c.maxVoxels!==8388608 || c.chunkUpload?.version!==1 || c.chunkUpload?.maxChunkBytes!==262144 || c.model?.id!=="lungmask-R231" || c.model?.version!=="0.2.20" || c.model?.weightsSha256!==R231_SHA256 || c.model?.ready!==true) {
    throw new Error("Совместимый worker с проверенной Lungmask R231 недоступен. Обновите приложение и worker, проверьте зависимости и веса по руководству.");
  }
  return ["safe","balanced"].includes(c.resourceProfile?.name)?c.resourceProfile.name:undefined;
}
export function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new DOMException("Задание отменено.","AbortError"));};
    const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},400);
    signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();
  });
}
export async function runLocalR231(session: WorkerSession, packet: AnalysisPackage | AnalysisStream, signal: AbortSignal,
  onStatus: (text: string)=>void): Promise<{mask: LabelMask; result: SegmentationResult; metrics: WorkerMetrics; evidence: SegmentationEvidence}> {
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
      if(status.state==="failed"||status.state==="cancelled")throw workerFailure({code:status.error,preflight:status.preflight},500);
      if(status.state==="succeeded") {
        const result=parseSegmentationResult(JSON.stringify(status.result));
        if(result.model.id!=="lungmask-R231"||result.model.version!=="0.2.20"||result.model.weightsSha256!==R231_SHA256)throw new Error("Неожиданная модель результата.");
        const response=await call(session,`/v1/jobs/${jobId}/mask`,{signal});
        const length=Number(response.headers.get("content-length"));
        if(!Number.isSafeInteger(length)||length<352||length>MAX_MASK_FILE_BYTES)throw new Error("Неверный размер маски worker.");
        const buffer=await boundedMask(response,length);
        if(buffer.byteLength!==length)throw new Error("Неполная маска worker.");
        const mask=parseNiftiMask(buffer);
        const maskDigest=await sha256(buffer);
        assertResultBinding(result,packet.request,mask,maskDigest);
        const m=status.metrics;
        if(m?.device!=="cpu" || ![m.inferenceSeconds,m.totalSeconds,m.peakRssMiB].every(v=>typeof v==="number"&&Number.isFinite(v)&&v>=0) || typeof m.platform!=="string" || typeof m.machine!=="string")throw new Error("Worker не вернул проверяемые метрики.");
        if(m.preflight!==undefined) {
          const p=resourcePreflight(m.preflight);
          if(!p||p.guardDecision!=="allow"||m.guardDecision!=="allow")throw new Error("Worker не вернул проверяемый preflight.");
          m.preflight=p;
        }
        onStatus("Подготовка Evidence по проверенной маске…");
        const evidence=await buildSegmentationEvidence(packet.request,result,mask,maskDigest,{executionMode:"local",signal});
        return {mask,result,metrics:m,evidence};
      }
      if(!["queued","running"].includes(status.state))throw new Error("Неизвестное состояние worker.");
      onStatus(`R231 · ${status.state==="running"?"вычисление":"очередь"} · ${Number(status.elapsedSeconds).toFixed(1)} с`);
      await pause(signal);
    }
  } finally {
    if(jobId)await call(session,`/v1/jobs/${jobId}`,{method:"DELETE",signal:AbortSignal.timeout(5000)}).catch(()=>{});
  }
}
