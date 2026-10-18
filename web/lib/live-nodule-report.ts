/** Research browser import of a TRUE completed MONAI 0.6.9 CPU prediction
 * for the exact original uncompressed NIfTI CT, with source SHA and physical
 * 3D geometry gate. Only ONE original axial CT plane is decoded at a time.
 * No DICOM SOP binding, model run in browser or clinical validation.
 */
import {sha256} from "@noble/hashes/sha2.js";
import {invertAffine,transformPoint,type Affine,type Point3} from "./segmentation-mask.ts";
export const MAX_MONAI_CT_BYTES=352+512*512*300*4;
const CHECKPOINT="b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01";
const REV="7226a40a4c3713f7d5469559b7f2fc296fd54825";
export type NoduleNativeSource={
 dimensions:Point3;affineLps:Affine;bytesPerVoxel:2|4;
 datatype:4|16;bytes:number;
};
export type NoduleCandidate={
 index:number;score:number;centerLpsMm:Point3;extentModelMm:Point3;
 nativeVoxelIndexHypothesis:Point3|null;
 sourceCoordinateFrameIndependentlyVerified:false;clinicalFindingConfirmed:false;
};
export type BoundNoduleReport={
 schema:"opus-monai-bound-nodule-inference/v1";
 source:{format:"NIfTI-1-uncompressed";modality:"CT";anatomy:"CHEST";
    sha256:string;dimensions:Point3;affineLps:Affine;
    headerVerified:true;operatorVerifiedFullSelectedSeries:true;
    sourceDICOMIdentityIndependentlyVerified:false};
 model:{id:"monai-lung-nodule-ct-retinanet";version:"0.6.9";weightsSha256:string;
   bundleRevision:string;pretrainedCheckpointReadFromVerifiedBundle:true};
 execution:{type:"isolated-linux-cpu-research";actualPretrainedInferenceCompleted:true;
    modelCalledOnThisExactSource:true;seconds:number;peakProcessRssBytes:number;
    cpuPatch:[192,192,80];upstreamEvaluationPatchModified:true};
 candidates:NoduleCandidate[];clinicalStatus:"unverified_research_draft";
 sourceWorldCoordinateFrameIndependentlyVerified:false;
 clinicallyValidated:false;negativeDiagnosisAllowed:false;limitations:string[];
};
const finite=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n);
const tuple=(v:unknown,length:number)=>Array.isArray(v)&&v.length===length&&v.every(finite);
const sha=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{64}$/.test(v);
const object=(v:unknown):Record<string,unknown>=>{
 if(!v||typeof v!=="object"||Array.isArray(v))throw Error("Неверный JSON MONAI.");
 return v as Record<string,unknown>;
};
export async function readNoduleNiftiHeader(file:Blob):Promise<NoduleNativeSource>{
 if(file.size<352||file.size>MAX_MONAI_CT_BYTES)
   throw Error("Недопустимый размер несжатой КТ NIfTI для локального просмотра.");
 const header=await file.slice(0,352).arrayBuffer(),v=new DataView(header);
 if(v.getInt32(0,true)!==348||[110,43,49,0].some((n,i)=>v.getUint8(344+i)!==n)||
    v.getInt16(40,true)!==3||[48,50,52,54].some(k=>v.getInt16(k,true)!==1))
   throw Error("Ожидается оригинальный одноканальный NIfTI-1 в little-endian.");
 const dimensions=[v.getInt16(42,true),v.getInt16(44,true),v.getInt16(46,true)] as Point3;
 if(dimensions.some((n,i)=>n<8||n>[512,512,300][i]))
   throw Error("Размеры CT выходят за пределы локального просмотра.");
 const datatype=v.getInt16(70,true);const bytes=datatype===16?4:datatype===4?2:0;
 if(!bytes||v.getInt16(72,true)!==8*bytes||
    v.getFloat32(108,true)!==352||
    v.getInt16(252,true)!==0||![1,2].includes(v.getInt16(254,true))||
    (v.getUint8(123)&7)!==2||
    file.size!==352+dimensions.reduce((a,b)=>a*b,1)*bytes)
   throw Error("Неверный размер, HU-тип или геометрия NIfTI.");
 const slope=v.getFloat32(112,true),inter=v.getFloat32(116,true);
 if(!(slope===0||Number.isNaN(slope)||(slope===1&&(inter===0||Number.isNaN(inter)))))
   throw Error("Нужно оригинальное HU без неучтённого rescale.");
 const affineLps=Array.from({length:12},(_,i)=>{
   const n=v.getFloat32(280+i*4,true);return i<8?-n:n;
 }) as Affine;
 invertAffine(affineLps);
 const axis=[0,1,2].map(j=>Math.hypot(affineLps[j],affineLps[4+j],affineLps[8+j]));
 if(axis.some(n=>!finite(n)||n<0.1||n>20))
   throw Error("Неподдерживаемая физическая геометрия КТ.");
 const u=[0,1,2].map(j=>[affineLps[j]/axis[j],affineLps[4+j]/axis[j],affineLps[8+j]/axis[j]]);
 for(let i=0;i<3;i++)for(let j=0;j<i;j++)
   if(Math.abs(u[i].reduce((sum,n,k)=>sum+n*u[j][k],0))>1e-4)
     throw Error("Невозможна точная геометрия без сдвига/ресэмплинга.");
 return {dimensions,affineLps,datatype:datatype as 4|16,bytesPerVoxel:bytes as 2|4,bytes:file.size};
}
export function parseBoundNoduleReport(raw:string,src:NoduleNativeSource):BoundNoduleReport{
 if(raw.length<250||raw.length>1024*1024)throw Error("Слишком большой или пустой отчёт MONAI.");
 const p=object(JSON.parse(raw)),source=object(p.source),model=object(p.model),run=object(p.execution);
 const dims=source.dimensions,affine=source.affineLps,expected=src.affineLps;
 if(p.schema!=="opus-monai-bound-nodule-inference/v1"||
    source.format!=="NIfTI-1-uncompressed"||source.modality!=="CT"||source.anatomy!=="CHEST"||
    !sha(source.sha256)||!tuple(dims,3)||!(dims as number[]).every((x,i)=>x===src.dimensions[i])||
    !tuple(affine,12)||
    source.headerVerified!==true||source.operatorVerifiedFullSelectedSeries!==true||
    source.sourceDICOMIdentityIndependentlyVerified!==false||
    model.id!=="monai-lung-nodule-ct-retinanet"||model.version!=="0.6.9"||
    model.weightsSha256!==CHECKPOINT||model.bundleRevision!==REV||
    model.pretrainedCheckpointReadFromVerifiedBundle!==true||
    run.type!=="isolated-linux-cpu-research"||run.actualPretrainedInferenceCompleted!==true||
    run.modelCalledOnThisExactSource!==true||
    !finite(run.seconds)||run.seconds<=0||
    !finite(run.peakProcessRssBytes)||run.peakProcessRssBytes<=0||
    !tuple(run.cpuPatch,3)||(run.cpuPatch as number[]).join(",")!=="192,192,80"||
    run.upstreamEvaluationPatchModified!==true||
    p.clinicalStatus!=="unverified_research_draft"||
    p.sourceWorldCoordinateFrameIndependentlyVerified!==false||
    p.clinicallyValidated!==false||p.negativeDiagnosisAllowed!==false||
    !Array.isArray(p.candidates)||p.candidates.length>300||
    !Array.isArray(p.limitations)||p.limitations.length<3||
    !p.limitations.every(n=>typeof n==="string"&&n.length>0&&n.length<=500))
    throw Error("Невозможно подтвердить источник, веса или ограничения MONAI.");
 // Measure all eight original CT corners, not just approximate float32 coefficients.
 for(let mask=0;mask<8;mask++){
   const point=src.dimensions.map((n,i)=>mask&(1<<i)?n-1:0);
   const a=transformPoint(affine as Affine,point),b=transformPoint(expected,point);
   if(Math.hypot(...a.map((n,i)=>n-b[i]))>0.05)
     throw Error("Исходная КТ и отчёт имеют разную физическую сетку.");
 }
 const seen=new Set<number>(),inv=invertAffine(expected);
 for(const candidate of p.candidates){
   const c=object(candidate);
   if(!Number.isSafeInteger(c.index)||Number(c.index)<0||seen.has(c.index)||
      !finite(c.score)||c.score<0||c.score>1||
      !tuple(c.centerLpsMm,3)||!tuple(c.extentModelMm,3)||
      !(c.extentModelMm as number[]).every(x=>x>0&&x<=100)||
      c.sourceCoordinateFrameIndependentlyVerified!==false||
      c.clinicalFindingConfirmed!==false)
     throw Error("Недостоверный кандидат модели.");
   seen.add(c.index as number);
   const x=transformPoint(inv,c.centerLpsMm as Point3),v=c.nativeVoxelIndexHypothesis;
   const inside=x.every((n,i)=>n>=-0.5&&n<=src.dimensions[i]-0.5);
   if((v===null)!==!inside||(inside&&(!tuple(v,3)||
       Math.hypot(...x.map((n,i)=>n-(v as number[])[i]))>0.02)))
     throw Error("Кандидат не соответствует исходной пространственной сетке.");
 }
 return p as BoundNoduleReport;
}
/** The actual NIfTI's SHA-256 is checked before ANY report pixels are shown. */
export async function verifyNoduleSource(file:Blob,sha256Expected:string,signal?:AbortSignal){
 if(!sha(sha256Expected)||file.size>MAX_MONAI_CT_BYTES)throw Error("Недопустимый источник.");
 const h=sha256.create();let count=0;
 const reader=file.stream().getReader();
 try{
  for(;;){if(signal?.aborted)throw Error("Проверка отменена.");
   const {done,value}=await reader.read();if(done)break;
   count+=value.byteLength;if(count>MAX_MONAI_CT_BYTES)throw Error("Исходник слишком большой.");
   h.update(value);
  }
 }finally{if(signal?.aborted)await reader.cancel().catch(()=>{});reader.releaseLock();}
 const result=Array.from(h.digest(),n=>n.toString(16).padStart(2,"0")).join("");
 if(count!==file.size||result!==sha256Expected)throw Error("Исходная КТ отличается от исследования MONAI (SHA-256).");
}
/** Read at most one 512x512 native axial source plane, without decoding CT volume. */
export async function readNoduleAxial(file:Blob,src:NoduleNativeSource,k:number):Promise<Float32Array|Int16Array>{
 if(!Number.isSafeInteger(k)||k<0||k>=src.dimensions[2])
   throw Error("Неверный срез.");
 const bytes=src.dimensions[0]*src.dimensions[1]*src.bytesPerVoxel;
 const start=352+k*bytes;
 const buffer=await file.slice(start,start+bytes).arrayBuffer();
 if(buffer.byteLength!==bytes)throw Error("Усечённый срез.");
 const values=src.datatype===16?new Float32Array(buffer):new Int16Array(buffer);
 if(src.datatype===16&&Array.from(values).some(x=>!Number.isFinite(x)))
   throw Error("Некорректные HU на срезе.");
 return values;
}
