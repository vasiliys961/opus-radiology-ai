/** Local candidate only. Metadata removal and human review are not a cloud release. */
import { sha256 } from "@noble/hashes/sha2.js";

export const MAX_PRIVACY_PIXELS=1024*1024,MAX_PRIVACY_PNG_BYTES=2*1024*1024,MAX_PRIVACY_FRAMES=4,MAX_REDACTIONS=32;
export type PrivacyRectangle={x:number;y:number;width:number;height:number};
export type PrivacyFrame={frameId:string;modality:"CT"|"MR";width:number;height:number;
  pngBase64:string;sha256:string;redactions:PrivacyRectangle[];
  pixelReviewSha256:string|null;visualReviewSha256:string|null};
export type VisionPrivacyPacket={schema:"opus-vision-privacy/v1";packetId:string;
  status:"local-review-draft";coverage:"sampled-frames-only";metadataPolicy:"pixel-only-no-DICOM";
  transmissionPermitted:false;deidentificationVerified:false;frames:PrivacyFrame[]};
const signature=[137,80,78,71,13,10,26,10];
const crcTable=Uint32Array.from({length:256},(_,n)=>{
  let c=n;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;
});
function crc32(bytes:Uint8Array):number {
  let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;
}
const digest=(bytes:Uint8Array)=>Array.from(sha256(bytes),b=>b.toString(16).padStart(2,"0")).join("");

/** Keep only raster chunks. Never preserve EXIF/text/ICC/DICOM or trailing bytes. */
export function stripPngMetadata(bytes:Uint8Array):{bytes:Uint8Array;width:number;height:number} {
  if(bytes.length>MAX_PRIVACY_PNG_BYTES||bytes.length<57||signature.some((b,i)=>bytes[i]!==b))
    throw new Error("Копия должна быть PNG не более 2 МиБ.");
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),parts:Uint8Array[]=[bytes.subarray(0,8)];
  let at=8,width=0,height=0,header=false,data=false,ended=false;
  while(at<bytes.length){
    if(at+12>bytes.length)throw new Error("Повреждённый PNG.");
    const length=view.getUint32(at),end=at+12+length;
    if(end>bytes.length)throw new Error("Повреждённая длина PNG.");
    const type=String.fromCharCode(...bytes.subarray(at+4,at+8));
    if(!/^[A-Za-z]{4}$/.test(type)||crc32(bytes.subarray(at+4,end-4))!==view.getUint32(end-4))
      throw new Error("Контрольная сумма PNG не совпадает.");
    if(type==="IHDR"){
      if(header||at!==8||length!==13)throw new Error("Неверный заголовок PNG.");
      width=view.getUint32(at+8);height=view.getUint32(at+12);
      if(!width||!height||width*height>MAX_PRIVACY_PIXELS||bytes[at+16]!==8||![2,6].includes(bytes[at+17])||
        bytes[at+18]!==0||bytes[at+19]!==0||bytes[at+20]!==0)
        throw new Error("Только RGB/RGBA PNG 8 bit до 1 048 576 пикселей без interlace.");
      header=true;
    }else if(type==="IDAT"){
      if(!header||ended)throw new Error("Неверный порядок PNG.");data=true;
    }else if(type==="IEND"){
      if(!data||length!==0||end!==bytes.length)throw new Error("Неверное завершение PNG.");ended=true;
    }else if((bytes[at+4]&32)===0){
      throw new Error("Неподдерживаемый обязательный блок PNG.");
    }
    if(type==="IHDR"||type==="IDAT"||type==="IEND")parts.push(bytes.subarray(at,end));
    at=end;
  }
  if(!ended)throw new Error("PNG не завершён.");
  const cleaned=new Uint8Array(parts.reduce((sum,p)=>sum+p.length,0));
  let offset=0;for(const p of parts){cleaned.set(p,offset);offset+=p.length;}
  return {bytes:cleaned,width,height};
}
export function pngFromBase64(value:string):Uint8Array {
  if(typeof value!=="string"||value.length>Math.ceil(MAX_PRIVACY_PNG_BYTES/3)*4||
    value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    throw new Error("Неверная или слишком большая копия PNG.");
  const raw=atob(value);
  if(raw.length>MAX_PRIVACY_PNG_BYTES||btoa(raw)!==value)throw new Error("Неверная кодировка PNG.");
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
function toBase64(bytes:Uint8Array):string {
  const chunks:string[]=[];
  for(let at=0;at<bytes.length;at+=8192)chunks.push(String.fromCharCode(...bytes.subarray(at,at+8192)));
  return btoa(chunks.join(""));
}
export function validatePrivacyRectangle(r:PrivacyRectangle,width:number,height:number):PrivacyRectangle {
  if(!r||![r.x,r.y,r.width,r.height].every(Number.isSafeInteger)||r.x<0||r.y<0||r.width<1||r.height<1||
    r.x+r.width>width||r.y+r.height>height)throw new Error("Область скрытия должна находиться внутри кадра.");
  return {x:r.x,y:r.y,width:r.width,height:r.height};
}
export function createPrivacyFrame(bytes:Uint8Array,frameId:string,modality:"CT"|"MR",redactions:PrivacyRectangle[]=[]):PrivacyFrame {
  if(!/^frame-[1-4]$/.test(frameId)||!["CT","MR"].includes(modality)||!Array.isArray(redactions)||redactions.length>MAX_REDACTIONS)
    throw new Error("Неподдерживаемая копия кадра или лимит 32 областей скрытия.");
  const cleaned=stripPngMetadata(bytes);
  return {frameId,modality,width:cleaned.width,height:cleaned.height,pngBase64:toBase64(cleaned.bytes),sha256:digest(cleaned.bytes),
    redactions:redactions.map(r=>validatePrivacyRectangle(r,cleaned.width,cleaned.height)),pixelReviewSha256:null,visualReviewSha256:null};
}
export function markPrivacyReview(frame:PrivacyFrame,kind:"pixel"|"visual",reviewed:boolean):PrivacyFrame {
  return {...frame,[kind==="pixel"?"pixelReviewSha256":"visualReviewSha256"]:reviewed?frame.sha256:null};
}
/** Explicit allowlist. Local links, filenames, SOPs, hashes of source and text stay out. */
export function buildVisionPrivacyPacket(frames:readonly PrivacyFrame[],packetId:string):VisionPrivacyPacket {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(packetId)||
    !frames.length||frames.length>MAX_PRIVACY_FRAMES||new Set(frames.map(f=>f.frameId)).size!==frames.length)
    throw new Error("Пакет ограничен четырьмя разными кадрами и новым случайным ID.");
  const normalized=frames.map(f=>{
    const next=createPrivacyFrame(pngFromBase64(f.pngBase64),f.frameId,f.modality,f.redactions);
    if(next.width!==f.width||next.height!==f.height||next.sha256!==f.sha256||
      f.pixelReviewSha256!==next.sha256||f.visualReviewSha256!==next.sha256)
      throw new Error("Проверьте надписи и узнаваемые признаки в каждой точной копии кадра.");
    return {...next,pixelReviewSha256:next.sha256,visualReviewSha256:next.sha256};
  });
  return {schema:"opus-vision-privacy/v1",packetId,status:"local-review-draft",coverage:"sampled-frames-only",
    metadataPolicy:"pixel-only-no-DICOM",transmissionPermitted:false,deidentificationVerified:false,frames:normalized};
}
