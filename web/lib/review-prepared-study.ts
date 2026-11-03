/** Explicit physician attestation for exact locally prepared study copies.
 * OCR never calls this or supplies the human attestation. Journal stays local.
 */
import type {AutomaticPrivacyPreparation} from './auto-privacy-preparation.ts';
import {appendPrivacyEvent,exportPrivacyJournal} from './privacy-review-journal.ts';
import {markPrivacyReview,buildVisionPrivacyPacket} from './vision-privacy.ts';
export function reviewPreparedStudy(groups:readonly AutomaticPrivacyPreparation[],physicianAttested:boolean){
 if(!physicianAttested||groups.length<1||groups.length>500)throw Error('Требуется явная проверка точных копий врачом.');
 return groups.map(g=>{
  let journal=g.journal;
  const frames=g.frames.map(f=>{
   const ocr=g.ocr[f.frameId];
   if(!ocr||ocr.sha256!==f.sha256)throw Error('Проверка надписей не соответствует копии.');
   if(ocr.regions.length>0)journal=appendPrivacyEvent(journal,f.frameId,f.sha256,{kind:'text-retained'},new Date().toISOString());
   for(const review of ['pixel','visual'] as const)journal=appendPrivacyEvent(journal,f.frameId,f.sha256,{kind:'review-set',review,checked:true},new Date().toISOString());
   return markPrivacyReview(markPrivacyReview(f,'pixel',true),'visual',true);
  });
  const packet=buildVisionPrivacyPacket(frames,crypto.randomUUID());
  exportPrivacyJournal(journal,packet.frames);
  return {journal,packet};
 });
}
