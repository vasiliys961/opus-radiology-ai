"use client";
import {useState,type ChangeEvent} from "react";
import {sha256} from "@noble/hashes/sha2.js";
type Finding={sourceVoxelBox:number[][];sourceVoxelCentroid:number[];niftiWorldCentroidMm:number[];candidateVolumeMl:number;candidateVoxels:number;renalCancerProven:false};
type Report={schema:"opus-original-MONAI-renal-CECT-neoplasm-3phase/v1";phaseSHA256:Record<string,string>;predictionMaskSHA256:string;checkpointSHA256:string;sourceNativeShape:number[];componentCandidates:Finding[];threeRegisteredPhasesUsed:true;originalPretrainedInferenceCompleted:true;sourceGridVerified:true;neoplasmModelOutputChannel:4;clinicallyValidated:false;patientUseAllowed:false;negativeCancerDiagnosis:false;independentHoldout:false;TP?:number;FP?:number;FN?:number;singleCaseVoxelDice?:number|null};
const sha=(s:unknown)=>typeof s==="string"&&/^[a-f0-9]{64}$/.test(s);
const nonnegative=(n:unknown)=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
function parse(raw:unknown):Report{
 if(!raw||typeof raw!=="object")throw Error("Некорректный JSON");
 const x=raw as Record<string,unknown>,phases=x.phaseSHA256 as Record<string,unknown>;
 if(x.schema!=="opus-original-MONAI-renal-CECT-neoplasm-3phase/v1"||
 !phases||Object.keys(phases).sort().join(",")!=="artery,excret,vein"||
 !["artery","vein","excret"].every(p=>sha(phases[p]))||
 !sha(x.checkpointSHA256)||!sha(x.predictionMaskSHA256)||
 x.threeRegisteredPhasesUsed!==true||x.originalPretrainedInferenceCompleted!==true||
 x.sourceGridVerified!==true||x.neoplasmModelOutputChannel!==4||
 x.clinicallyValidated!==false||x.patientUseAllowed!==false||
 x.negativeCancerDiagnosis!==false||x.independentHoldout!==false||
 !Array.isArray(x.sourceNativeShape)||x.sourceNativeShape.length!==3||
 x.sourceNativeShape.some((n:unknown)=>!Number.isSafeInteger(n)||Number(n)<16)||
 !Array.isArray(x.componentCandidates)||x.componentCandidates.length>128)
 throw Error("Неподдерживаемый отчёт трёхфазной модели почек");
 for(const item of x.componentCandidates as Record<string,unknown>[]){
 if(!item||item.renalCancerProven!==false||!nonnegative(item.candidateVolumeMl)||
 !Number.isSafeInteger(item.candidateVoxels)||Number(item.candidateVoxels)<1||
 !Array.isArray(item.sourceVoxelCentroid)||item.sourceVoxelCentroid.length!==3||
 !item.sourceVoxelCentroid.every(nonnegative)||
 !Array.isArray(item.niftiWorldCentroidMm)||item.niftiWorldCentroidMm.length!==3||
 !item.niftiWorldCentroidMm.every((n:unknown)=>typeof n==="number"&&Number.isFinite(n))||
 !Array.isArray(item.sourceVoxelBox)||item.sourceVoxelBox.length!==3||
 item.sourceVoxelBox.some((b:unknown,i:number)=>!Array.isArray(b)||b.length!==2||b.some((n:unknown)=>!Number.isSafeInteger(n))||b[0]<0||b[1]<b[0]||b[1]>=Number((x.sourceNativeShape as number[])[i])))
 throw Error("Некорректные 3D-координаты предполагаемой опухоли");
 }
 if(["TP","FP","FN"].some(k=>x[k]!==undefined)&&
 !["TP","FP","FN"].every(k=>Number.isSafeInteger(x[k])&&Number(x[k])>=0))throw Error("Неверные экспертные счётчики");
 if(x.singleCaseVoxelDice!==undefined&&x.singleCaseVoxelDice!==null&&(!nonnegative(x.singleCaseVoxelDice)||Number(x.singleCaseVoxelDice)>1))throw Error("Недостоверный Dice");
 return x as unknown as Report;
}
export default function RenalNeoplasmThreePhaseEvidence(){
 const [report,setReport]=useState<Report|null>(null),[verified,setVerified]=useState<Record<string,boolean>>({}),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 async function load(e:ChangeEvent<HTMLInputElement>){const f=e.target.files?.[0];e.target.value="";setReport(null);setVerified({});setError("");if(!f)return;
 try{if(f.size>120000)throw Error("Отчёт превышает 120 КБ");setReport(parse(JSON.parse(await f.text())));}
 catch(err){setError(err instanceof Error?err.message:"Ошибка JSON");}}
 async function check(e:ChangeEvent<HTMLInputElement>,field:string){const f=e.target.files?.[0];e.target.value="";if(!f||!report)return;setVerified(v=>({...v,[field]:false}));setError("");
 if(f.size>800*1024*1024){setError("Лимит одного исходного файла 800 МиБ");return;}
 setBusy(true);const reader=f.stream().getReader();const h=sha256.create();let size=0;
 try{for(;;){const b=await reader.read();if(b.done)break;size+=b.value.length;if(size>800*1024*1024)throw Error("Превышен предел файла");h.update(b.value);}
 const digest=Array.from(h.digest(),v=>v.toString(16).padStart(2,"0")).join("");
 const expected=field==="mask"?report.predictionMaskSHA256:report.phaseSHA256[field];
 if(digest!==expected||size!==f.size)throw Error("SHA-256 не совпадает: "+field);
 setVerified(v=>({...v,[field]:true}));
 }catch(err){setError(err instanceof Error?err.message:"Ошибка проверки SHA");}
 finally{reader.releaseLock();setBusy(false);}}
 const ready=["artery","vein","excret","mask"].every(p=>verified[p]);
 return <section aria-label="Почки: трёхфазная модель опухоли, научный просмотр">
 <h3>Почки · MONAI · трёхфазная КТ · опухолевые кандидаты</h3>
 <p>Только исследовательский отчёт: артериальная, венозная и экскреторная фазы должны быть зарегистрированы. Ни один кандидат не подтверждает рак; отсутствие кандидатов не исключает опухоль.</p>
 <label>Числовой отчёт модели <input type="file" accept=".json" onChange={e=>void load(e)}/></label>
 {error&&<p role="alert">{error}</p>}
 {report&&<div>
 {(["artery","vein","excret","mask"] as const).map(p=><label key={p}>{({artery:"Артериальная КТ",vein:"Венозная КТ",excret:"Экскреторная КТ",mask:"Маска модели"} as const)[p]} · {verified[p]?"SHA подтверждён":"не проверено"} <input type="file" accept=".nii,.gz" disabled={busy} onChange={e=>void check(e,p)}/></label>)}
 <p role="status">{ready?"Все четыре источника совпали по SHA-256":"Для просмотра числовых находок подтвердите три фазы и маску"}</p>
 {ready&&<div><p>Предполагаемых очагов: {report.componentCandidates.length}. Уверенность и клиническая точность не установлены.</p>
 <ol>{report.componentCandidates.map((c,i)=><li key={i}>Кандидат {i+1}: центр RAS {c.niftiWorldCentroidMm.join(", ")} мм, объём {c.candidateVolumeMl.toFixed(2)} мл; IJK {c.sourceVoxelCentroid.join(", ")}.</li>)}</ol>
 {typeof report.TP==="number"&&<p>Один экспертный случай: TP {report.TP}, FP {report.FP}, FN {report.FN}; Dice {report.singleCaseVoxelDice?.toFixed(3)??"нет"} — не независимая валидация.</p>}
 </div>}
 </div>}</section>;
}
