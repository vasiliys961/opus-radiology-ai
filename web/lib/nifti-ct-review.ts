/** Strict browser-only, slice-windowed NIfTI-1 CT source review.
 * Never synthesize DICOM, resample segmentation labels or decode full 3D CT.
 * Only original-grid 32-slice windows in memory on M1 8 GiB.
 */
import {sha256} from "@noble/hashes/sha2.js";
import {assertMaskMatchesSource, invertAffine, maskColor, transformPoint,
  type Affine,type LabelMask,type Point3} from "./segmentation-mask.ts";
import type {AnatomyProof} from "./totalseg-abdomen-import.ts";

export const MAX_NIFTI_CT_FILE=128*1024*1024;
export const MAX_NIFTI_CT_SLAB_VOXELS=8*1024*1024;
export const MAX_NIFTI_CT_SLICES=32;

export type NiftiCtSource={
  dimensions:Point3;
  affineLps:Affine;
  datatype:4|16;
  bytesPerVoxel:2|4;
  bytes:number;
};
export type NativeCtSlab={
  dimensions:Point3;
  affineLps:Affine;
  pixels:Float32Array|Int16Array;
  sourceRange:[number,number];
  sourceSha256:string;
};

const validSHA=(s:string)=>/^[a-f0-9]{64}$/.test(s);
const finite=(array:number[])=>array.every(Number.isFinite);
const near=(a:number[],b:number[])=>Math.hypot(...a.map((x,i)=>x-b[i]))<=0.05;

export async function readNiftiCtHeader(file:Blob):Promise<NiftiCtSource>{
  if(!file.size||file.size>MAX_NIFTI_CT_FILE||file.size<352)
    throw Error("Исходная КТ NIfTI превышает 128 МиБ или пуста. Выберите несжатый .nii.");
  const bytes=await file.slice(0,352).arrayBuffer();
  const v=new DataView(bytes);
  if(v.getInt32(0,true)!==348 || String.fromCharCode(...new Uint8Array(bytes,344,4))!=="n+1\u0000")
    throw Error("Ожидается несжатый NIfTI-1 little-endian .nii (не .nii.gz).");
  if(v.getInt16(40,true)!==3)throw Error("Нужна ровно одна трёхмерная КТ.");
  const dims:Point3=[v.getInt16(42,true),v.getInt16(44,true),v.getInt16(46,true)];
  if(dims.some((n,i)=>n<2||n>(i===2?300:512))||
    [48,50,52,54].some(k=>v.getInt16(k,true)!==1))
    throw Error("Размеры или дополнительные NIfTI-каналы не поддерживаются.");
  const datatype=v.getInt16(70,true);
  const bpp=datatype===16?4:datatype===4?2:0;
  if(!bpp||v.getInt16(72,true)!==bpp*8||v.getFloat32(108,true)!==352)
    throw Error("Поддерживается только исходная КТ float32 или int16 с offset 352.");
  if((v.getUint8(123)&7)!==2 || ![1,2].includes(v.getInt16(254,true))||
    v.getInt16(252,true)!==0)
    throw Error("Нужна недвусмысленная sform геометрия NIfTI в миллиметрах.");
  const slope=v.getFloat32(112,true),intercept=v.getFloat32(116,true);
  if(!(slope===0||Number.isNaN(slope)||(slope===1&&(intercept===0||Number.isNaN(intercept)))))
    throw Error("Исходные интенсивности NIfTI не должны требовать масштабирования.");
  const voxels=dims[0]*dims[1]*dims[2];
  if(!Number.isSafeInteger(voxels)||file.size!==352+voxels*bpp)
    throw Error("Размер файла не соответствует числу исходных CT-вокселей.");
  const ras=Array.from({length:12},(_,i)=>v.getFloat32(280+4*i,true));
  if(!finite(ras))throw Error("Некорректные исходные координаты.");
  const affineLps=ras.map((x,i)=>i<8?(x===0?0:-x):x) as Affine;
  invertAffine(affineLps);
  const voxelVolume=Math.abs(
    affineLps[0]*(affineLps[5]*affineLps[10]-affineLps[6]*affineLps[9])
    -affineLps[1]*(affineLps[4]*affineLps[10]-affineLps[6]*affineLps[8])
    +affineLps[2]*(affineLps[4]*affineLps[9]-affineLps[5]*affineLps[8]));
  if(voxelVolume<0.00001||voxelVolume>1000)
    throw Error("Пространственный масштаб источника не подходит для просмотра.");
  return {dimensions:dims,affineLps,datatype:datatype as 4|16,
    bytesPerVoxel:bpp as 2|4,bytes:file.size};
}

/** Uses incremental hash and Blob.stream. No full-file ArrayBuffer allocation. */
export async function verifyNiftiCtSource(file:Blob,expectedSha:string,signal?:AbortSignal){
  if(!validSHA(expectedSha)||!file.size||file.size>MAX_NIFTI_CT_FILE)
    throw Error("Отсутствует допустимый паспорт источника КТ.");
  const hash=sha256.create();
  let total=0;
  const reader=file.stream().getReader();
  try{
    for(;;){
      if(signal?.aborted)throw Error("Проверка исходной КТ отменена.");
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>MAX_NIFTI_CT_FILE)throw Error("Исходная КТ превышает лимит.");
      hash.update(value);
    }
  }finally{
    if(signal?.aborted)await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
  if(total!==file.size||Array.from(hash.digest(),n=>n.toString(16).padStart(2,"0")).join("")!==expectedSha)
    throw Error("SHA-256 исходной КТ не совпадает с паспортом исследования.");
}

export async function loadNativeCtSlab(file:Blob, source:NiftiCtSource,
  proof:AnatomyProof,signal?:AbortSignal):Promise<NativeCtSlab>{
  if(proof.anatomy!=="abdomen"||source.dimensions.some((n,i)=>n!==proof.fullDimensions[i]))
    throw Error("Эта КТ не соответствует паспортному исследованию брюшной полости.");
  const start=proof.firstSlice,count=proof.lastSlice-start+1;
  if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(count)||
      count>MAX_NIFTI_CT_SLICES||count<1||start+count>source.dimensions[2]||
      source.dimensions[0]*source.dimensions[1]*count>MAX_NIFTI_CT_SLAB_VOXELS)
    throw Error("Срезы выходят за ограниченный объём MPR для M1.");
  await verifyNiftiCtSource(file,proof.sourceSha256,signal);
  if(signal?.aborted)throw Error("Загрузка исходной КТ отменена.");
  const countVoxels=source.dimensions[0]*source.dimensions[1]*count;
  const offset=352+start*source.dimensions[0]*source.dimensions[1]*source.bytesPerVoxel;
  const data=await file.slice(offset,offset+countVoxels*source.bytesPerVoxel).arrayBuffer();
  if(signal?.aborted)throw Error("Загрузка исходной КТ отменена.");
  if(data.byteLength!==countVoxels*source.bytesPerVoxel)throw Error("Фрагмент КТ усечён.");
  const pixels=source.datatype===16?new Float32Array(data):new Int16Array(data);
  if(source.datatype===16){
    // Recheck scalar corruption after extraction, before committing to UI.
    for(const value of pixels)if(!Number.isFinite(value))throw Error("КТ содержит недопустимые интенсивности.");
  }
  const affine=[...source.affineLps] as Affine;
  affine[3]+=start*affine[2];
  affine[7]+=start*affine[6];
  affine[11]+=start*affine[10];
  invertAffine(affine);
  return {
    dimensions:[source.dimensions[0],source.dimensions[1],count],
    affineLps:affine,pixels,sourceRange:[start,start+count-1],
    sourceSha256:proof.sourceSha256,
  };
}

/** Same source-coordinate identity required. Permuted/reversed masks must be
 * explicitly reconciled before rasterization, never silently assigned indices.
 */
export function assertSameNativeIndexGrid(slab:NativeCtSlab,mask:LabelMask){
  assertMaskMatchesSource(mask,{dimensions:slab.dimensions,affineLps:slab.affineLps});
  if(mask.dimensions.some((n,i)=>n!==slab.dimensions[i]))
    throw Error("Нужны одинаковые оригинальные индексы CT и маски.");
  for(const p of [
    [0,0,0],[slab.dimensions[0]-1,0,0],
    [0,slab.dimensions[1]-1,0],[0,0,slab.dimensions[2]-1],
    slab.dimensions.map(n=>n-1)]){
    if(!near(transformPoint(mask.affineLps,p),transformPoint(slab.affineLps,p)))
      throw Error("Порядок индексов CT и маски разный. Перестановка запрещена.");
  }
  if(mask.data.length!==slab.pixels.length)
    throw Error("Размеры маски и КТ расходятся.");
}
export type IndexPlane="i"|"j"|"k";
/** Native voxel-index planes, not asserted to be anatomical axial/coronal/sagittal.
 * Independent of camera, no image interpolation and no patient data sent.
 */
export function renderNativeCtPlane(slab:NativeCtSlab,
  plane:IndexPlane,index:number,width:number,height:number,
  center:number,windowWidth:number,mask?:LabelMask,selectedLabel:number|null=null,
  opacity=0.4):Uint8ClampedArray {
  if(!["i","j","k"].includes(plane)||!Number.isSafeInteger(index)||
      ![width,height].every(v=>Number.isSafeInteger(v)&&v>0&&v<=384)||
      !Number.isFinite(center)||!Number.isFinite(windowWidth)||windowWidth<=0||
      !Number.isFinite(opacity)||opacity<0||opacity>0.8)
    throw Error("Параметры окна или индексной плоскости КТ неверны.");
  const dims=slab.dimensions;
  const axis=plane==="k"?2:plane==="j"?1:0;
  if(index<0||index>=dims[axis])throw Error("Плоскость выходит за КТ.");
  if(mask)assertSameNativeIndexGrid(slab,mask);
  const [nx,ny]=dims,axes=plane==="k"?[0,1]:plane==="j"?[0,2]:[1,2];
  const result=new Uint8ClampedArray(width*height*4);
  const low=center-windowWidth/2;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const pos=[0,0,0];
    pos[axis]=index;
    pos[axes[0]]=Math.min(dims[axes[0]]-1,Math.floor((x+0.5)*dims[axes[0]]/width));
    pos[axes[1]]=Math.min(dims[axes[1]]-1,Math.floor((y+0.5)*dims[axes[1]]/height));
    const linear=pos[0]+nx*(pos[1]+ny*pos[2]);
    const scalar=slab.pixels[linear];
    const grey=Math.max(0,Math.min(255,Math.round(255*(scalar-low)/windowWidth)));
    const at=(y*width+x)*4;
    result[at]=grey;result[at+1]=grey;result[at+2]=grey;result[at+3]=255;
    const label=mask?.data[linear];
    if(label && (selectedLabel===null||label===selectedLabel)){
      const color=maskColor(label);
      for(let k=0;k<3;k++)result[at+k]=Math.round(grey*(1-opacity)+color[k]*opacity);
    }
  }
  return result;
}
