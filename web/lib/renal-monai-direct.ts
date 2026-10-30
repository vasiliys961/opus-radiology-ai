import type {DicomSeries} from "./dicom-series.ts";
import {prepareDicomCtForPathology} from "./dicom-monai-direct.ts";
import {zipRenalNativePhases} from "./renal-three-phase-zip.ts";
import {sha256} from "@noble/hashes/sha2.js";
import {verifyRenalThreePhaseStudy,type RenalPhaseRole} from "./renal-three-phase-gate.ts";

export type RenalMonaiResult={
 schema:"opus-renal-monai-http-result/v1";sourceArchiveSHA256:string;
 report:{schema:"opus-original-MONAI-renal-CECT-neoplasm-3phase/v1";
 originalPretrainedInferenceCompleted:true;threeRegisteredPhasesUsed:true;
 checkpointSHA256:string;phaseSHA256:Record<string,string>;
 componentCandidates:Array<{sourceVoxelCentroid:number[];niftiWorldCentroidMm:number[];
 candidateVolumeMl:number;candidateVoxels:number;renalCancerProven:false}>};
};
export async function runRenalMonaiThreePhase(
 allSeries:ReadonlyArray<DicomSeries>,files:ReadonlyMap<string,File>,
 roles:Partial<Record<RenalPhaseRole,string>>,signal:AbortSignal,
 progress:(message:string)=>void=()=>{},
):Promise<RenalMonaiResult>{
 const gate=verifyRenalThreePhaseStudy(allSeries,new Set(files.keys()),roles);
 if(gate.status!=="ready_for_registration")throw Error(gate.reason);
 const capResponse=await fetch("/api/local-renal",{signal,cache:"no-store"});
 if(!capResponse.ok)throw Error("MONAI renal worker не готов.");
 const cap=await capResponse.json();
 if(cap.schema!=="opus-real-renal-monai-worker/v1"||cap.ready!==true||
  cap.originalWeightsVerified!==true)throw Error("Оригинальные веса MONAI недоступны.");
 const output={} as Record<RenalPhaseRole,File>;
 for(const role of ["artery","vein","excret"] as const){
  const vol=allSeries.find(s=>s.key===roles[role]);
  if(!vol)throw Error("Недоступна серия "+role);
  const nativeFiles=vol.members.map(m=>files.get(m.id));
  if(nativeFiles.some(f=>!f))throw Error("Отсутствует часть DICOM-срезов.");
  output[role]=await prepareDicomCtForPathology(vol,nativeFiles as File[],signal,"ABDOMEN",
   message=>progress(role+": "+message));
 }
 const archive=await zipRenalNativePhases(output,signal,progress);
 const hash=sha256.create();
 for(let pos=0;pos<archive.size;pos+=1024*1024){
  if(signal.aborted)throw Error("Анализ отменён.");
  hash.update(new Uint8Array(await archive.slice(pos,Math.min(pos+1024*1024,archive.size)).arrayBuffer()));
 }
 const sha=Array.from(hash.digest(),b=>b.toString(16).padStart(2,"0")).join("");
 const result=await fetch("/api/local-renal",{method:"POST",body:archive,signal,
  headers:{"Content-Type":"application/zip","X-Opus-Source-Sha256":sha,
   "X-Opus-Three-Phase-Research":"authorized-registered-kidney-roi"},cache:"no-store"});
 if(!result.ok)throw Error("MONAI не подтвердил совмещение фаз, ROI или оригинальный forward (HTTP "+result.status+").");
 const x=await result.json() as RenalMonaiResult;
 if(x.schema!=="opus-renal-monai-http-result/v1"||x.sourceArchiveSHA256!==sha||
  x.report?.schema!=="opus-original-MONAI-renal-CECT-neoplasm-3phase/v1"||
  x.report?.originalPretrainedInferenceCompleted!==true||
  x.report?.threeRegisteredPhasesUsed!==true||
  !Array.isArray(x.report.componentCandidates))
  throw Error("Недостоверный ответ трёхфазного MONAI.");
 return x;
}
