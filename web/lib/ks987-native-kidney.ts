import {originalNiftiSha256} from "./live-nodule-worker.ts";
export type Ks987NativeReport={schema:"opus-ks987-native-kidney-forward/v1";sourceNiftiSha256:string;originalModelForwardCompleted:true;nativeGridVerified:true;candidateComponentCount:number;candidateRegions:Array<{sourceVolumeMl:number;candidateVoxels:number;rasMmCentroid:number[];nativeCentroidVoxel:number[]}>};
export async function runKs987NativeKidney(source:File,signal:AbortSignal):Promise<Ks987NativeReport>{
 const sha=await originalNiftiSha256(source,signal);
 const r=await fetch("/api/local-ks987",{method:"POST",cache:"no-store",signal,body:source,
  headers:{"Content-Type":"application/octet-stream","X-Opus-Source-Sha256":sha,"X-Opus-Research-Authorized":"authorized-nonpatient"}});
 if(!r.ok)throw Error("Оригинальный KS987 worker не выполнил инференс.");
 const x=await r.json() as Ks987NativeReport;
 if(x.schema!=="opus-ks987-native-kidney-forward/v1"||x.sourceNiftiSha256!==sha||x.originalModelForwardCompleted!==true||
 x.nativeGridVerified!==true||!Number.isSafeInteger(x.candidateComponentCount)||x.candidateComponentCount<0||
 !Array.isArray(x.candidateRegions)||x.candidateComponentCount!==x.candidateRegions.length||
 x.candidateRegions.some(c=>!Number.isFinite(c.sourceVolumeMl)||c.sourceVolumeMl<0||
 !Array.isArray(c.rasMmCentroid)||c.rasMmCentroid.length!==3||c.rasMmCentroid.some(n=>!Number.isFinite(n))))
 throw Error("KS987 вернул неподтверждённые данные.");
 return x;
}
