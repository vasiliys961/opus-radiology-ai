import {buildVisionPrivacyPacket,type PrivacyFrame,type VisionPrivacyPacket} from './vision-privacy.ts';
import {CLOUD_PILOT_MAX_IMAGE_BASE64} from './sanitized-cloud-review.ts';
import type {VisionBatch} from './vision-batch-ledger.ts';
/** Repack exact reviewed pixels without re-encoding, source renumbering or larger server limits. */
export function partitionReviewedFrames(frames:readonly PrivacyFrame[]):PrivacyFrame[][]{
 const groups:PrivacyFrame[][]=[];let current:PrivacyFrame[]=[],bytes=0;
 for(const frame of frames){
  if(frame.pngBase64.length>CLOUD_PILOT_MAX_IMAGE_BASE64)throw Error('Одна подготовленная копия превышает размер передачи. Выберите одно окно КТ и подготовьте копии заново.');
  if(current.length&&(current.length===4||bytes+frame.pngBase64.length>CLOUD_PILOT_MAX_IMAGE_BASE64)){groups.push(current);current=[];bytes=0;}
  current.push(frame);bytes+=frame.pngBase64.length;
 }
 if(current.length)groups.push(current);
 return groups;
}
export function splitReviewedTransport(packets:readonly VisionPrivacyPacket[],batches:readonly VisionBatch[]){
 if(packets.length!==batches.length)throw Error('Проверенные копии не совпадают с исходным планом.');
 const nextPackets:VisionPrivacyPacket[]=[],nextBatches:VisionBatch[]=[];
 packets.forEach((packet,i)=>{
  if(packet.frames.length!==batches[i].indices.length)throw Error('Нарушена привязка кадров к исходным срезам.');
  let offset=0;
  for(const group of partitionReviewedFrames(packet.frames)){
   nextPackets.push(buildVisionPrivacyPacket(group.map((f,n)=>({...f,frameId:'frame-'+(n+1)})),crypto.randomUUID()));
   nextBatches.push({pass:batches[i].pass,indices:batches[i].indices.slice(offset,offset+group.length)});offset+=group.length;
  }
 });
 return {packets:nextPackets,batches:nextBatches};
}
