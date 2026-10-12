import {call,smallJson,boundedMask,pause,checkLocalWorker,workerFailure,LocalWorkerError,resourcePreflight,R231_SHA256,type WorkerSession,type WorkerMetrics} from "./local-worker.ts";
import {parseSegmentationResult,sha256,type SegmentationResult} from "./analysis-package.ts";
import {parseNiftiMask,assertMaskMatchesSource,type LabelMask} from "./segmentation-mask.ts";
import type {FullCtStream,FullCtRequest} from "./full-ct-stream.ts";

export type FullCtTicket={session:WorkerSession;jobId:string;request:FullCtRequest;result:SegmentationResult;
  labelVoxels:[number,number];metrics:WorkerMetrics};
const jobId=(v:unknown):string=>{if(typeof v!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v))throw Error("Неверный ID worker.");return v;};
export async function closeFullCt(ticket:Pick<FullCtTicket,"session"|"jobId">) {
  try{await call(ticket.session,`/v1/jobs/${ticket.jobId}`,{method:"DELETE",keepalive:true,signal:AbortSignal.timeout(5000)});}
  catch(e){if(!(e instanceof LocalWorkerError)||e.code!=="job_not_found")throw e;}
}
export async function checkFullCtWorker(session:WorkerSession,signal:AbortSignal) {
  await checkLocalWorker(session,signal);
  const c=await smallJson(await call(session,"/v1/capabilities",{signal}));
  if(c.fullCt?.requestSchema!=="opus-analysis-request/v2"||c.fullCt.maxPlane!==512||c.fullCt.maxFrames!==300||
    c.fullCt.maskAccess!=="bounded-slabs-only")throw Error("Обновите worker: полный поток КТ v2 не поддерживается.");
}
export async function runFullCt(session:WorkerSession,packet:FullCtStream,signal:AbortSignal,onStatus:(text:string)=>void):Promise<FullCtTicket> {
  await checkFullCtWorker(session,signal);let identifier:string|null=null,retained=false;
  try {
    const created=await smallJson(await call(session,"/v1/jobs",{method:"POST",signal,headers:{"Content-Type":"application/json"},
      body:JSON.stringify({schema:"opus-worker-job/v1",dataPolicy:"public-reference-only",
        acquisition:{anatomy:"CHEST",intensity:"HU",confirmedBy:"research-operator"},request:packet.request})}));
    identifier=jobId(created.jobId);let offset=0;
    for await(const chunk of packet.chunks(signal)) {
      if(chunk.byteLength>131072||offset+chunk.byteLength>packet.byteLength)throw Error("Неверный размер блока.");
      const ack=await smallJson(await call(session,`/v1/jobs/${identifier}/input/chunks/${offset}`,{method:"PUT",signal,
        headers:{"Content-Type":"application/octet-stream"},body:chunk}));
      offset+=chunk.byteLength;
      if(ack.state!=="receiving_chunks"||ack.uploadedBytes!==offset)throw Error("Worker не подтвердил блок КТ.");
      onStatus(`Передача полной серии: ${Math.floor(offset/packet.byteLength*100)}%`);
    }
    if(offset!==packet.byteLength)throw Error("Неполная серия.");
    await call(session,`/v1/jobs/${identifier}/input/complete`,{method:"POST",signal});
    for(;;) {
      const status=await smallJson(await call(session,`/v1/jobs/${identifier}`,{signal}));
      if(status.state==="failed")throw workerFailure({code:status.error,preflight:status.preflight},422);
      if(status.state==="succeeded") {
        const result=parseSegmentationResult(JSON.stringify(status.result)),full=status.result?.fullVolume;
        if(result.requestId!==packet.request.requestId||result.sourceIdentitySha256!==packet.request.sourceIdentitySha256||
          result.inputSha256!==packet.request.inputSha256||result.model.id!=="lungmask-R231"||result.model.modality!=="CT"||
          result.model.version!=="0.2.20"||result.model.weightsSha256!==R231_SHA256||
          full?.coverage!=="all-supplied-frames"||full.clinicalStatus!=="unverified_research_draft"||
          JSON.stringify(full.dimensions)!==JSON.stringify(packet.request.geometry.dimensions)||
          !Array.isArray(full.labelVoxels)||full.labelVoxels.length!==2||full.labelVoxels.some((n:unknown)=>typeof n!=="number"||!Number.isSafeInteger(n)||n<0)||
          full.labelVoxels.reduce((a:number,b:number)=>a+b,0)<=0||
          full.labelVoxels.reduce((a:number,b:number)=>a+b,0)>packet.request.geometry.dimensions.reduce((a,b)=>a*b))
          throw Error("Полный результат не привязан к исходной серии.");
        const metrics=status.metrics;
        if(metrics?.device!=="cpu"||metrics.inferenceImplementation!=="full-ct-streamed-r231/v2"||
          ![metrics.inferenceSeconds,metrics.totalSeconds,metrics.peakRssMiB].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>=0))
          throw Error("Неверные метрики worker.");
        retained=true;
        return{session:{...session},jobId:identifier,request:packet.request,result,labelVoxels:full.labelVoxels,
          metrics:{device:"cpu",inferenceSeconds:metrics.inferenceSeconds,totalSeconds:metrics.totalSeconds,peakRssMiB:metrics.peakRssMiB,
            inferenceImplementation:"full-ct-streamed-r231/v2",
            ...(typeof metrics.torchVersion==="string"&&/^2\.6\.0(?:\+[a-z0-9.]+)?$/.test(metrics.torchVersion)?{torchVersion:metrics.torchVersion}:{}),
            platform:["Darwin","Linux","Windows"].includes(metrics.platform)?metrics.platform:"unknown",
            machine:["arm64","aarch64","x86_64","AMD64","i386"].includes(metrics.machine)?metrics.machine:"unknown",
            ...(resourcePreflight(metrics.preflight)?{preflight:resourcePreflight(metrics.preflight)}:{}),
            ...(metrics.guardDecision==="allow"?{guardDecision:"allow"}:{}),
            ...(["safe","balanced"].includes(metrics.resourceProfile)?{resourceProfile:metrics.resourceProfile}:{}),
            ...(Number.isInteger(metrics.threads)&&metrics.threads>=1&&metrics.threads<=2?{threads:metrics.threads}:{}),
            ...(metrics.interOpThreads===1?{interOpThreads:1}:{})}};
      }
      if(!["queued","running"].includes(status.state))throw Error("Неизвестное состояние полного задания.");
      const p=status.progress;
      onStatus(p&&["inference","postprocessing","restoration"].includes(p.stage)&&Number.isInteger(p.completedFrames)&&
        p.totalFrames===packet.request.frameCount&&p.completedFrames>=0&&p.completedFrames<=p.totalFrames?
        `Полная КТ · ${p.stage} · ${p.completedFrames}/${p.totalFrames}`:`Полная КТ · ${status.state}`);
      await pause(signal);
    }
  } finally {if(identifier&&!retained)await closeFullCt({session,jobId:identifier}).catch(()=>{});}
}
export async function loadFullCtSlab(ticket:FullCtTicket,start:number,count:number,signal:AbortSignal):Promise<LabelMask> {
  const d=ticket.request.geometry.dimensions;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(count)||start<0||count<3||count>32||start+count>d[2]||d[0]*d[1]*count>8388608)
    throw Error("Неверный диапазон маски.");
  const response=await call(ticket.session,`/v1/jobs/${ticket.jobId}/mask-slab`,{method:"POST",signal,
    headers:{"Content-Type":"application/json"},body:JSON.stringify({start,count})});
  const encoded=response.headers.get("X-Opus-Mask-Proof");
  const reject=async(message:string):Promise<never>=>{await response.body?.cancel().catch(()=>{});throw Error(message);};
  if(!encoded||encoded.length>8192)return reject("Нет паспорта фрагмента маски.");
  let proof;try{proof=JSON.parse(atob(encoded));}catch{return reject("Неверный паспорт фрагмента.");}
  if(!proof||typeof proof!=="object"||Array.isArray(proof))return reject("Неверный паспорт фрагмента.");
  const affine=[...ticket.request.geometry.affineLps];for(let row=0;row<3;row++)affine[row*4+3]+=affine[row*4+2]*start;
  const geometry={dimensions:[d[0],d[1],count] as [number,number,number],affineLps:affine as typeof ticket.request.geometry.affineLps};
  if(proof.schema!=="opus-full-ct-slab/v1"||proof.jobId!==ticket.jobId||proof.requestId!==ticket.request.requestId||
    proof.sourceIdentitySha256!==ticket.request.sourceIdentitySha256||proof.inputSha256!==ticket.request.inputSha256||
    proof.fullMaskSha256!==ticket.result.maskSha256||proof.start!==start||proof.count!==count||proof.sourceFrameCount!==d[2]||
    JSON.stringify(proof.geometry)!==JSON.stringify(geometry)||typeof proof.slabMaskSha256!=="string"||!/^[a-f0-9]{64}$/.test(proof.slabMaskSha256))return reject("Чужой фрагмент маски.");
  const bytes=await boundedMask(response,352+d[0]*d[1]*count);
  if(await sha256(bytes)!==proof.slabMaskSha256)throw Error("SHA фрагмента маски не совпадает.");
  const mask=parseNiftiMask(bytes);assertMaskMatchesSource(mask,geometry);return mask;
}
/** Explicit allowlist: token/endpoint/session never enter exported results. */
export function fullCtReport(ticket:FullCtTicket) {
  const a=ticket.request.geometry.affineLps,voxelMl=Math.abs(a[0]*a[5]*a[10])/1000;
  return{schema:"opus-full-ct-evidence/v1",clinicalStatus:"unverified_research_draft",coverage:"all-supplied-frames-not-acquisition-verified",
    request:{...ticket.request,geometry:{dimensions:[...ticket.request.geometry.dimensions],affineLps:[...a]}},result:ticket.result,
    observations:ticket.labelVoxels.map((voxels,i)=>({labelId:i+1,voxels,volumeMl:voxels*voxelMl,task:"lung-mask-not-pathology"})),metrics:ticket.metrics};
}
