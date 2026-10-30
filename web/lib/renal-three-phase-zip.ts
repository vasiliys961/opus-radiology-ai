/** ZIP32 STORE of three native research CT NIfTI files. Bounded chunk reads.
 * Does not invent phase registration or kidney ROI. Worker independently checks.
 */
const ROLES=["artery","vein","excret"] as const;
const names=ROLES.map(x=>x+".nii");
const encoder=new TextEncoder();
const write16=(d:DataView,o:number,v:number)=>d.setUint16(o,v,true);
const write32=(d:DataView,o:number,v:number)=>d.setUint32(o,v>>>0,true);
function crcTable():Uint32Array{
 const t=new Uint32Array(256);
 for(let n=0;n<256;n++){let c=n;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;
}
const TABLE=crcTable();
function checksum(c:number,bytes:Uint8Array):number{
 for(const b of bytes)c=TABLE[(c^b)&255]^(c>>>8);return c>>>0;
}
export async function zipRenalNativePhases(files:Record<(typeof ROLES)[number],File>,
 signal:AbortSignal,progress:(s:string)=>void=()=>{}):Promise<Blob>{
 const parts:BlobPart[]=[];const dirs:Uint8Array[]=[];let offset=0;
 for(let index=0;index<ROLES.length;index++){
  const role=ROLES[index],file=files[role],name=encoder.encode(names[index]);
  if(!file||file.size<1024||file.size>400*1024*1024||signal.aborted)throw Error("Три ограниченные исходные фазы обязательны.");
  let crc=0xffffffff;
  for(let pos=0;pos<file.size;pos+=1024*1024){
   if(signal.aborted)throw Error("Прерван анализ.");
   crc=checksum(crc,new Uint8Array(await file.slice(pos,Math.min(pos+1024*1024,file.size)).arrayBuffer()));
  }
  crc=(crc^0xffffffff)>>>0;
  const header=new Uint8Array(30+name.length),h=new DataView(header.buffer);
  write32(h,0,0x04034b50);write16(h,4,20);write16(h,8,0);
  write32(h,14,crc);write32(h,18,file.size);write32(h,22,file.size);
  write16(h,26,name.length);header.set(name,30);
  parts.push(header,file);
  const dir=new Uint8Array(46+name.length),d=new DataView(dir.buffer);
  write32(d,0,0x02014b50);write16(d,4,20);write16(d,6,20);
  write32(d,16,crc);write32(d,20,file.size);write32(d,24,file.size);
  write16(d,28,name.length);write32(d,42,offset);dir.set(name,46);
  dirs.push(dir);offset+=header.length+file.size;
  progress("Подготовлена "+(index+1)+" из 3 фаз для MONAI.");
 }
 const central=dirs.reduce((a,x)=>a+x.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);
 write32(v,0,0x06054b50);write16(v,8,3);write16(v,10,3);
 write32(v,12,central);write32(v,16,offset);
 return new Blob([...parts,...dirs.map(d=>new Uint8Array(d)),new Uint8Array(end)],{type:"application/zip"});
}
