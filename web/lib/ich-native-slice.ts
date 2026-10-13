/** Bounded source-native k-slice reader for hash-verified PUBLIC NIfTI CT + SAMIHS mask.
 * Streams/decompresses to a single 2D slice; never copies the entire 3D CT.
 * NIfTI RAS affine is NOT a verified original DICOM SOP reference.
 */
export type NiftiSliceKind="ct"|"mask";
export type NativeIchSlice={
  pixels:Float32Array|Uint8Array;
  dimensions:[number,number];
  sliceIndex:number;
  nativeIndexOrder:true;
};

function validateHeader(header:Uint8Array,dimensions:readonly number[],
  affine:readonly (readonly number[])[],kind:NiftiSliceKind,slice:number){
  const v=new DataView(header.buffer,header.byteOffset,header.byteLength);
  if(v.getInt32(0,true)!==348||
     String.fromCharCode(...header.slice(344,348))!=="n+1\u0000")
    throw Error("Требуется однозначный little-endian NIfTI-1.");
  if(v.getInt16(40,true)!==3||[48,50,52,54].some(i=>v.getInt16(i,true)!==1))
    throw Error("Нужна одна трёхмерная КТ без дополнительных каналов.");
  if(dimensions.length!==3||dimensions.some((x,i)=>v.getInt16(42+2*i,true)!==x))
    throw Error("Источник и паспорт модели имеют разные размеры.");
  if(dimensions.some(n=>!Number.isSafeInteger(n)||n<16||n>512)||
     !Number.isSafeInteger(slice)||slice<0||slice>=dimensions[2])
    throw Error("Срез вне допустимого диапазона.");
  const datatype=v.getInt16(70,true);
  const bytes=datatype===2?1:datatype===4?2:datatype===16?4:0;
  if(!bytes||v.getInt16(72,true)!==bytes*8||
     (kind==="mask"&&datatype!==2)||
     (kind==="ct"&&datatype!==4&&datatype!==16))
    throw Error("Неподдерживаемый тип пикселей исходной КТ или маски.");
  const voxOffset=v.getFloat32(108,true);
  if(!Number.isSafeInteger(voxOffset)||voxOffset<352||voxOffset>4096)
    throw Error("Неоднозначное расположение исходных NIfTI-вокселей.");
  if(v.getInt16(254,true)<=0)
    throw Error("Нужна проверяемая sform-ориентация исходного NIfTI.");
  if(!Array.isArray(affine)||affine.length!==4||
     affine.some(row=>!Array.isArray(row)||row.length!==4))
    throw Error("Отсутствует физическая сетка исходной КТ.");
  for(let row=0;row<3;row++)for(let col=0;col<4;col++){
    const actual=v.getFloat32(280+(row*4+col)*4,true);
    if(!Number.isFinite(actual)||!Number.isFinite(affine[row][col])||
       Math.abs(actual-affine[row][col])>0.001)
      throw Error("Sform CT/маски не совпадает с исходным паспортом.");
  }
  const slope=v.getFloat32(112,true),intercept=v.getFloat32(116,true);
  if(!Number.isFinite(slope)||!Number.isFinite(intercept)||
     (kind==="mask"&&slope!==0&&slope!==1)||
     (kind==="mask"&&intercept!==0))
    throw Error("Неоднозначный масштаб NIfTI-пикселей.");
  return {datatype,bytes,voxOffset,slope:slope===0?1:slope,intercept};
}

/** Can read gzip NIfTI because the streaming decompressor is stopped after
 * the requested slice. SHA-256 of the entire original compressed file MUST be
 * checked by caller before invoking this helper.
 */
export async function readNativeIchKSlice(
  file:Blob,kind:NiftiSliceKind,index:number,
  dimensions:readonly number[],affine:readonly (readonly number[])[],
  signal?:AbortSignal
):Promise<NativeIchSlice>{
 if(!file.size||file.size>512*1024*1024)throw Error("Файл изображения превышает 512 МиБ.");
 const magic=new Uint8Array(await file.slice(0,2).arrayBuffer());
 const compressed=magic[0]===31&&magic[1]===139;
 if(compressed&&typeof DecompressionStream==="undefined")
   throw Error("Браузер не поддерживает потоковую gzip-распаковку.");
 const stream=compressed?file.stream().pipeThrough(new DecompressionStream("gzip")):file.stream();
 const reader=stream.getReader();
 const head=new Uint8Array(352);
 let absolute=0,headCount=0,info:ReturnType<typeof validateHeader>|null=null;
 let output:Uint8Array|null=null,sectionStart=0,sectionEnd=0;
 let copied=0;
 try{
   for(;;){
     if(signal?.aborted)throw Error("Загрузка исходного среза отменена.");
     const item=await reader.read();
     if(item.done)break;
     const chunk=item.value;
     const end=absolute+chunk.byteLength;
     if(headCount<352&&absolute<352){
       const length=Math.min(end,352)-absolute;
       if(length>0){
         head.set(chunk.subarray(0,length),absolute);
         headCount+=length;
       }
     }
     if(headCount===352&&!info){
       info=validateHeader(head,dimensions,affine,kind,index);
       const voxels=dimensions[0]*dimensions[1];
       const byteLength=voxels*info.bytes;
       sectionStart=info.voxOffset+index*byteLength;
       sectionEnd=sectionStart+byteLength;
       if(!Number.isSafeInteger(sectionEnd)||sectionEnd>512*1024*1024)
          throw Error("Запрошенный срез превышает допустимый диапазон.");
       output=new Uint8Array(byteLength);
     }
     if(info&&output){
       const left=Math.max(absolute,sectionStart),right=Math.min(end,sectionEnd);
       if(right>left){
         output.set(chunk.subarray(left-absolute,right-absolute),left-sectionStart);
         copied+=right-left;
       }
       if(copied===output.length)break;
     }
     absolute=end;
     if(absolute>512*1024*1024)throw Error("NIfTI поток превышает предельный размер.");
   }
 }finally{
   await reader.cancel().catch(()=>{});
   reader.releaseLock();
 }
 if(!info||!output||copied!==output.byteLength)
   throw Error("Недостаточно байт в исходном NIfTI-срезе.");
 const count=dimensions[0]*dimensions[1];
 if(kind==="mask"){
   for(const value of output)if(value!==0&&value!==1)
     throw Error("Маска содержит значения вне 0/1.");
   return {pixels:output,dimensions:[dimensions[0],dimensions[1]],
     sliceIndex:index,nativeIndexOrder:true};
 }
 const v=new DataView(output.buffer,output.byteOffset,output.byteLength);
 const pixels=new Float32Array(count);
 for(let i=0;i<count;i++){
   const raw=info.datatype===4?v.getInt16(i*2,true):v.getFloat32(i*4,true);
   const intensity=raw*info.slope+info.intercept;
   if(!Number.isFinite(intensity))throw Error("Исходная КТ содержит недопустимые значения.");
   pixels[i]=intensity;
 }
 return {pixels,dimensions:[dimensions[0],dimensions[1]],
   sliceIndex:index,nativeIndexOrder:true};
}
