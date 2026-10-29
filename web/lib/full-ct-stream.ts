import {sha256 as incrementalSha256} from "@noble/hashes/sha2.js";
import {fullCtNiftiHeader,sourceIdentity,type AnalysisRequest} from "./analysis-package.ts";
import {groupDicomSeries,type DicomSeries} from "./dicom-series.ts";
import type {MaskGeometry} from "./segmentation-mask.ts";

export type FullCtRequest=Omit<AnalysisRequest,"schema">&{schema:"opus-analysis-request/v2"};
export type NativePlane={values:ArrayLike<number>;slope:number;intercept:number;release:()=>void};
export type PlaneReader=(index:number,signal:AbortSignal)=>Promise<NativePlane>;
export type FullCtStream={request:FullCtRequest;byteLength:number;chunks:(signal:AbortSignal)=>AsyncIterable<ArrayBuffer>};
const abort=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException("Полная КТ закрыта.","AbortError");};
function fullNativeGeometry(series:DicomSeries,modality:"CT"|"MR"):MaskGeometry {
  if(series.modality!==modality||series.selection||!series.volumeReady||!series.spatiallySorted)
    throw new Error("Нужна полная загруженная КТ-серия с подтверждённой геометрией.");
  const checked=groupDicomSeries(series.members);
  if(checked.length!==1||!checked[0].volumeReady||checked[0].members.some((m,i)=>m.id!==series.members[i].id))
    throw new Error("Исходные координаты или порядок серии изменились.");
  const m=series.members[0].metadata,o=m.imageOrientationPatient!,s=m.pixelSpacing!,p=m.imagePositionPatient!;
  const next=series.members[1].metadata.imagePositionPatient!;
  const affineLps=p.flatMap((v,i)=>[o[i]*s[1],o[i+3]*s[0],next[i]-v,v]) as MaskGeometry["affineLps"];
  const geometry:MaskGeometry={dimensions:[m.columns!,m.rows!,series.members.length],affineLps};
  fullCtNiftiHeader(geometry);
  for(let z=0;z<series.members.length;z++) {
    const frame=series.members[z].metadata;
    for(const x of [0,m.columns!-1])for(const y of [0,m.rows!-1]) {
      const error=[0,1,2].map(i=>frame.imagePositionPatient![i]+frame.imageOrientationPatient![i]*frame.pixelSpacing![1]*x+
        frame.imageOrientationPatient![i+3]*frame.pixelSpacing![0]*y-
        (affineLps[i*4]*x+affineLps[i*4+1]*y+affineLps[i*4+2]*z+affineLps[i*4+3]));
      if(Math.hypot(...error)>0.05)throw new Error("Полная КТ не совпадает с единой физической сеткой без ресэмплинга.");
    }
  }
  return geometry;
}
export const fullCtGeometry=(series:DicomSeries)=>fullNativeGeometry(series,"CT");
export const fullMrGeometry=(series:DicomSeries)=>fullNativeGeometry(series,"MR");
export async function* fullCtChunks(geometry:MaskGeometry,read:PlaneReader,signal:AbortSignal,
  onFrame:(n:number)=>void=()=>{}):AsyncGenerator<ArrayBuffer> {
  const {header}=fullCtNiftiHeader(geometry);abort(signal);yield header;
  const planeSize=geometry.dimensions[0]*geometry.dimensions[1];
  for(let z=0;z<geometry.dimensions[2];z++) {
    abort(signal);const plane=await read(z,signal);
    try {
      if(plane.values.length!==planeSize||!Number.isFinite(plane.slope)||!Number.isFinite(plane.intercept)||plane.slope===0)
        throw new Error("Некорректные скаляры или rescale КТ-среза.");
      for(let start=0;start<planeSize;start+=32768) {
        abort(signal);const n=Math.min(32768,planeSize-start),buffer=new ArrayBuffer(n*4),view=new DataView(buffer);
        for(let i=0;i<n;i++){
          const value=plane.values[start+i]*plane.slope+plane.intercept;
          if(!Number.isFinite(value)||!Number.isFinite(Math.fround(value)))throw new Error("Некорректные HU.");
          view.setFloat32(i*4,value,true);
        }
        yield buffer; // No next frame/block before an acknowledged consumer resumes.
      }
      onFrame(z+1);
    } finally {plane.release();}
    await new Promise<void>(r=>setTimeout(r,0));
  }
  abort(signal);
}
export async function prepareFullCtStream(series:DicomSeries,read:PlaneReader,signal:AbortSignal,onFrame:(n:number)=>void=()=>{}):Promise<FullCtStream> {
  const geometry=fullCtGeometry(series),requestId=crypto.randomUUID();
  const identity=await sourceIdentity(series,requestId),hash=incrementalSha256.create();let inputSha256:string;
  try{for await(const chunk of fullCtChunks(geometry,read,signal,onFrame))hash.update(new Uint8Array(chunk));
    inputSha256=Array.from(hash.digest(),n=>n.toString(16).padStart(2,"0")).join("");}finally{hash.destroy();}
  abort(signal);
  return{byteLength:352+geometry.dimensions.reduce((a,b)=>a*b)*4,
    chunks:nextSignal=>fullCtChunks(geometry,read,nextSignal),
    request:{schema:"opus-analysis-request/v2",requestId,sourceIdentitySha256:identity,inputSha256,geometry,
      modality:"CT",frameCount:series.members.length,input:{format:"NIfTI-1",datatype:"float32",scalarValues:"cornerstone-decoded-no-additional-normalization"},
      scope:"selected-series-only",sequence:"not-confirmed",coverage:"not-confirmed"}};
}


/** Bounded MRI SCALAR stream, NOT HU. Exact original MR DICOM signal after
 * explicit rescale; same source-derived geometry and SHA algorithm as CT.
 * DWI/ADC/FLAIR vs T1/T1c/T2 weightings are supplied by the operator separately.
 */
export async function prepareFullMrStream(series:DicomSeries,read:PlaneReader,
 signal:AbortSignal,onFrame:(n:number)=>void=()=>{}):Promise<FullCtStream>{
 const geometry=fullMrGeometry(series),requestId=crypto.randomUUID();
 const identity=await sourceIdentity(series,requestId);
 const hash=incrementalSha256.create();let inputSha256:string;
 try{for await(const chunk of fullCtChunks(geometry,read,signal,onFrame))
   hash.update(new Uint8Array(chunk));
   inputSha256=Array.from(hash.digest(),b=>b.toString(16).padStart(2,"0")).join("");
 }finally{hash.destroy();}
 abort(signal);
 return{byteLength:352+geometry.dimensions.reduce((a,b)=>a*b,1)*4,
  chunks:nextSignal=>fullCtChunks(geometry,read,nextSignal),
  request:{schema:"opus-analysis-request/v2",requestId,
   sourceIdentitySha256:identity,inputSha256,geometry,modality:"MR",
   frameCount:series.members.length,
   input:{format:"NIfTI-1",datatype:"float32",
     scalarValues:"cornerstone-decoded-no-additional-normalization"},
   scope:"selected-series-only",sequence:"not-confirmed",coverage:"not-confirmed"}};
}
