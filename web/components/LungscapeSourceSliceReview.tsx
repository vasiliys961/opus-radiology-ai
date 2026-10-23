"use client";
import {useEffect,useRef,useState} from "react";

export type LungscapeBox={modelClassId:number;sourceModelLabel:string;sourceVoxelBoundsInclusive:number[][];candidateVoxelCount:number};
type Header={dim:[number,number,number];offset:number;type:4|16;scale:number;intercept:number};
const MAX_DECODED=450*1024*1024;
function headerOf(data:Uint8Array):Header {
 if(data.byteLength<352)throw Error("NIfTI заголовок неполный");
 const v=new DataView(data.buffer,data.byteOffset,data.byteLength);
 if(v.getInt32(0,true)!==348||String.fromCharCode(...data.slice(344,348))!=="n+1\0")throw Error("Нужен NIfTI-1 single-file");
 if(v.getInt16(40,true)!==3)throw Error("Нужна 3D-КТ");
 const dim:[number,number,number]=[42,44,46].map(i=>v.getInt16(i,true)) as [number,number,number];
 if(dim.some((n,i)=>n<2||n>(i===2?500:512)))throw Error("Серия превышает допустимые размеры");
 const type=v.getInt16(70,true);
 if(type!==4&&type!==16)throw Error("Поддерживается int16/float32 CT NIfTI");
 const offset=v.getFloat32(108,true);
 if(!Number.isSafeInteger(offset)||offset<352||offset>4096)throw Error("Недопустимое смещение NIfTI");
 const bytes=type===4?2:4;
 if(offset+dim[0]*dim[1]*dim[2]*bytes>MAX_DECODED)throw Error("Исследование превышает бюджет потокового просмотра");
 const rawScale=v.getFloat32(112,true),rawIntercept=v.getFloat32(116,true);
 const scale=rawScale===0||Number.isNaN(rawScale)?1:rawScale;
 const intercept=rawScale===0||Number.isNaN(rawScale)?0:rawIntercept;
 if(!Number.isFinite(scale)||!Number.isFinite(intercept))throw Error("Некорректная шкала CT");
 return {dim,offset,type:type as 4|16,scale,intercept};
}
async function readPlane(file:File,k:number,signal:AbortSignal){
 // For gz NIfTI, decode as a stream and retain only the exact original k-plane.
 const gz=file.name.toLowerCase().endsWith(".gz");
 const stream=gz?file.stream().pipeThrough(new DecompressionStream("gzip")):file.stream();
 const reader=stream.getReader();
 let position=0;let hdr:Header|null=null;let start=0;let end=0;
 let slice:Uint8Array|null=null,used=0;
 const first=new Uint8Array(4096);let headerCount=0;
 try {
  while(true){
   if(signal.aborted)throw Error("Просмотр отменён");
   const item=await reader.read();if(item.done)break;
   const value=item.value;
   if(!hdr){
    const take=Math.min(4096-headerCount,value.byteLength);
    first.set(value.subarray(0,take),headerCount);headerCount+=take;
    if(headerCount>=352){
     hdr=headerOf(first);
     if(k<0||k>=hdr.dim[2])throw Error("Срез за пределами КТ");
     const n=hdr.dim[0]*hdr.dim[1]*(hdr.type===4?2:4);
     start=hdr.offset+k*n;end=start+n;slice=new Uint8Array(n);
    }
   }
   if(hdr&&slice){
    const from=Math.max(start,position),to=Math.min(end,position+value.length);
    if(from<to){slice.set(value.subarray(from-position,to-position),from-start);used+=to-from;}
   }
   position+=value.byteLength;
   if(position>MAX_DECODED)throw Error("Превышен лимит распаковки CT");
   if(hdr&&position>=end)break;
  }
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 if(!hdr||!slice||used!==slice.length)throw Error("Данные среза NIfTI усечены");
 return {hdr,slice};
}
export default function LungscapeSourceSliceReview({source,candidates}:{source:File;candidates:LungscapeBox[]}){
 const [k,setK]=useState(0),[max,setMax]=useState(0),[error,setError]=useState("");
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{let active=true;const abort=new AbortController();setError("");
   void (async()=>{try{
    const {hdr,slice}=await readPlane(source,k,abort.signal);if(!active)return;
    setMax(hdr.dim[2]-1);
    const [nx,ny]=hdr.dim;const image=new ImageData(nx,ny),v=new DataView(slice.buffer);
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
      const i=x+y*nx;const raw=hdr.type===4?v.getInt16(i*2,true):v.getFloat32(i*4,true);
      const hu=raw*hdr.scale+hdr.intercept;
      const gray=Number.isFinite(hu)?Math.max(0,Math.min(255,Math.round((hu+150)/450*255))):0;
      const q=((ny-1-y)*nx+x)*4;image.data[q]=gray;image.data[q+1]=gray;image.data[q+2]=gray;image.data[q+3]=255;
    }
    const el=canvas.current;if(!el)return;el.width=nx;el.height=ny;
    const ctx=el.getContext("2d");if(!ctx)return;ctx.putImageData(image,0,0);
    ctx.lineWidth=Math.max(2,nx/200);ctx.strokeStyle="#00f0ad";ctx.font=`${Math.max(12,nx/30)}px sans-serif`;
    for(const box of candidates){
      const [lo,hi]=box.sourceVoxelBoundsInclusive;
      if(k<lo[2]||k>hi[2])continue;
      ctx.strokeRect(lo[0],ny-1-hi[1],hi[0]-lo[0]+1,hi[1]-lo[1]+1);
      ctx.fillStyle="#00f0ad";ctx.fillText(String(box.modelClassId),lo[0],Math.max(12,ny-1-hi[1]-4));
    }
   }catch(e){if(active)setError(e instanceof Error?e.message:"Ошибка NIfTI среза");}})();
   return()=>{active=false;abort.abort();};
 },[source,k,candidates]);
 return <div><p>Локальный просмотр исходного среза k — зелёные прямоугольники показывают только границы классов модели, не контуры сегментации.</p>
 <label>Срез k: {k} / {max}<input type="range" min={0} max={max} value={Math.min(k,max)} onChange={e=>setK(Number(e.target.value))}/></label>
 {error&&<p role="alert">{error}</p>}
 <canvas ref={canvas} style={{maxWidth:"100%",height:"auto",imageRendering:"pixelated"}} aria-label="Исходная КТ с прямоугольниками кандидатов LungSCAPE191"/>
 <p>Только после подтверждения SHA-256 источника; без привязки к произвольной DICOM-серии. Не для клинического заключения.</p></div>;
}
