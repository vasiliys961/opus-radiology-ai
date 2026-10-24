"use client";
import {useState,type ChangeEvent} from "react";
import {sha256} from "@noble/hashes/sha2.js";
type Candidate={sourceNativeVoxelBoundsInclusive:number[][];sourceNativeCentroidIJK:number[];sourceRASCentroidMm:number[];candidateVoxels:number;candidateVolumeMl:number;malignancyConfirmed:false};
type Report={schema:"opus-kits23-original-renal-tumor-voxel-metrics/v1";publicResearchCase:string;sourceCTSha256:string;modelMaskSha256:string;originalKS987CheckpointSha256:string;nativeSourceGeometryVerified:true;originalExpertLabelId:2;predictedTumorLabelId:1;expertTumorVoxels:number;predictedTumorVoxels:number;voxelTP:number;voxelFP:number;voxelFN:number;voxelDice:number;predictedNativeTumorCandidates:Candidate[];originalModelForwardNotEstablishedByScorer:true;independentHoldoutVerified:false;clinicalValidation:false;noImagePixelsOrMasksInReport:true};
const isHash=(x:unknown)=>typeof x==="string"&&/^[0-9a-f]{64}$/.test(x);
const finite=(x:unknown)=>typeof x==="number"&&Number.isFinite(x);
function parse(raw:unknown):Report{
 if(!raw||typeof raw!=="object")throw Error("JSON expected");
 const x=raw as Record<string,unknown>;
 if(x.schema!=="opus-kits23-original-renal-tumor-voxel-metrics/v1"||
 x.publicResearchCase!=="KiTS23 case_00021"||!isHash(x.sourceCTSha256)||
 !isHash(x.modelMaskSha256)||!isHash(x.originalKS987CheckpointSha256)||
 x.nativeSourceGeometryVerified!==true||x.originalExpertLabelId!==2||
 x.predictedTumorLabelId!==1||x.originalModelForwardNotEstablishedByScorer!==true||
 x.independentHoldoutVerified!==false||x.clinicalValidation!==false||
 x.noImagePixelsOrMasksInReport!==true||!Array.isArray(x.predictedNativeTumorCandidates)||
 x.predictedNativeTumorCandidates.length>256)throw Error("Unsupported research evidence");
 for(const k of ["expertTumorVoxels","predictedTumorVoxels","voxelTP","voxelFP","voxelFN"]){
 if(!Number.isSafeInteger(x[k])||Number(x[k])<0)throw Error("Invalid expert counters");
 }
 if(Number(x.voxelTP)+Number(x.voxelFN)!==Number(x.expertTumorVoxels)||
 Number(x.voxelTP)+Number(x.voxelFP)!==Number(x.predictedTumorVoxels)||
 !finite(x.voxelDice)||Number(x.voxelDice)<0||Number(x.voxelDice)>1)throw Error("Inconsistent voxel metrics");
 for(const p of x.predictedNativeTumorCandidates as Record<string,unknown>[]){
 if(!p||p.malignancyConfirmed!==false||!Number.isSafeInteger(p.candidateVoxels)||
 Number(p.candidateVoxels)<1||!finite(p.candidateVolumeMl)||Number(p.candidateVolumeMl)<0||
 !Array.isArray(p.sourceNativeVoxelBoundsInclusive)||p.sourceNativeVoxelBoundsInclusive.length!==3||
 p.sourceNativeVoxelBoundsInclusive.some((pair:unknown)=>!Array.isArray(pair)||pair.length!==2||pair.some((v:unknown)=>!Number.isSafeInteger(v)||Number(v)<0)||pair[0]>pair[1])||
 !Array.isArray(p.sourceNativeCentroidIJK)||p.sourceNativeCentroidIJK.length!==3||!p.sourceNativeCentroidIJK.every(finite)||
 !Array.isArray(p.sourceRASCentroidMm)||p.sourceRASCentroidMm.length!==3||!p.sourceRASCentroidMm.every(finite))
 throw Error("Invalid native 3D tumor candidate");
 }
 return x as unknown as Report;
}
export default function KiTS23RenalTumorEvidence(){
 const [data,setData]=useState<Report|null>(null),[verified,setVerified]=useState<Record<string,boolean>>({}),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function load(e:ChangeEvent<HTMLInputElement>){const f=e.target.files?.[0];e.target.value="";setData(null);setVerified({});setError("");
 if(!f)return;try{if(f.size>150000)throw Error("JSON exceeds limit");setData(parse(JSON.parse(await f.text())));}
 catch(err){setError(err instanceof Error?err.message:"Cannot parse report");}}
 async function check(e:ChangeEvent<HTMLInputElement>,kind:"ct"|"mask"){const f=e.target.files?.[0];e.target.value="";if(!f||!data)return;
 setVerified(v=>({...v,[kind]:false}));setError("");if(f.size>1024**3){setError("File exceeds 1 GiB");return;}
 setBusy(true);const h=sha256.create(),reader=f.stream().getReader();let count=0;
 try{for(;;){const part=await reader.read();if(part.done)break;count+=part.value.length;
 if(count>1024**3)throw Error("File too large");h.update(part.value);}
 const got=Array.from(h.digest(),v=>v.toString(16).padStart(2,"0")).join("");
 if(count!==f.size||got!==(kind==="ct"?data.sourceCTSha256:data.modelMaskSha256))throw Error("SHA-256 mismatch");
 setVerified(v=>({...v,[kind]:true}));
 }catch(err){setError(err instanceof Error?err.message:"Hash check failed");}finally{reader.releaseLock();setBusy(false);}}
 return <section aria-label="KiTS23 kidney tumor candidate evidence">
 <h3>Почки · KS987 · локализация опухолевых кандидатов</h3>
 <p>Исследовательская оценка исходной KiTS23 CT и маски. JSON scorer не подтверждает реальный forward сам по себе; диагностическая точность и злокачественность очагов не установлены.</p>
 <label>Числовой отчёт (.json) <input type="file" accept=".json" onChange={e=>void load(e)}/></label>
 {error&&<p role="alert">{error}</p>}
 {data&&<div>
 <p>Источник: {data.publicResearchCase}. Экспертных опухолевых вокселей: {data.expertTumorVoxels}.</p>
 <label>Оригинальная публичная КТ <input type="file" accept=".nii,.gz" disabled={busy} onChange={e=>void check(e,"ct")}/></label>
 <label>Исходная маска KS987 <input type="file" accept=".nii,.gz" disabled={busy} onChange={e=>void check(e,"mask")}/></label>
 <p role="status">{verified.ct&&verified.mask?"Оба SHA-256 совпали":"Нужно подтвердить исходную КТ и маску"}</p>
 {verified.ct&&verified.mask&&<div><p>Один случай: TP {data.voxelTP}; FP {data.voxelFP}; FN {data.voxelFN}; Dice {data.voxelDice.toFixed(3)}. Независимая валидация отсутствует.</p>
 <ol>{data.predictedNativeTumorCandidates.slice(0,50).map((p,i)=><li key={i}>
 Кандидат {i+1}: IJK {p.sourceNativeCentroidIJK.join(", ")}; RAS {p.sourceRASCentroidMm.join(", ")} мм; объём {p.candidateVolumeMl.toFixed(3)} мл.
 </li>)}</ol>
 {data.predictedNativeTumorCandidates.length>50&&<p>Показаны только первые 50 очагов.</p>}
 {data.predictedNativeTumorCandidates.length===0&&<p>Кандидаты не выделены. Это не исключает опухоль.</p>}
 </div>}</div>}</section>;
}
