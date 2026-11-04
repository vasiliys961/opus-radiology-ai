import test from 'node:test';
import assert from 'node:assert/strict';
import {followupStudyReport,validStudyFollowup} from './study-report-followup.ts';
const input={mode:'discuss',report:'Предварительное заключение. Оценено 12 из 150 срезов.',coverage:'12 из 150',clinicalContext:'Кашель 3 недели',question:'Что уточнить?',history:[],acknowledgeReviewedText:true};
test('reviewed discussion and translation stay text-only, carry coverage/history separately with receipt',async()=>{
 for(const mode of ['discuss','translate']){
  let calls=0;
  const result=await followupStudyReport({...input,mode},async r=>{
   calls++;const content=JSON.stringify(r.messages);
   assert.match(content,/12 из 150/);assert.match(content,/Кашель 3 недели/);assert.ok(!content.includes('image_url'));
   assert.match(content,mode==='translate'?/entire supplied provisional/:/TEXT ONLY/);
   return {choices:[{message:{content:JSON.stringify({text:'Test provisional answer'})}}],usage:{prompt_tokens:12,completion_tokens:5}};
  });
  assert.equal(calls,1);assert.equal(result.physicianReviewRequired,true);assert.equal(result.receipt.outputTokens,5);
 }
});
test('unapproved or unbounded discussion refuses before paid call; no automatic retries',async()=>{
 let calls=0;const call=async()=>{calls++;throw Error('Unavailable');};
 for(const bad of [{...input,acknowledgeReviewedText:false},{...input,report:''},{...input,clinicalContext:'x'.repeat(4001)},{...input,history:Array(9).fill({role:'user',content:'x'})},{...input,images:[]}]){
  assert.equal(validStudyFollowup(bad),false);await assert.rejects(()=>followupStudyReport(bad,call));
 }
 assert.equal(calls,0);await assert.rejects(()=>followupStudyReport(input,call));assert.equal(calls,1);
});
test('English translation receives the entire provisional report',async()=>{
 const report='ИССЛЕДОВАНИЕ: КТ.\nМЕТОДИКА: 12 срезов.\nОПИСАНИЕ: печень без очагов.\nЗАКЛЮЧЕНИЕ:\n1. КТ-признаки стеатоза печени.\nРЕКОМЕНДАЦИИ: контроль.';
 await followupStudyReport({...input,mode:'translate',report},async r=>{
  const content=JSON.stringify(r.messages);
  assert.match(content,/печень без очагов/);
  assert.match(content,/стеатоза печени/);
  assert.match(content,/РЕКОМЕНДАЦИИ: контроль/);
  return {choices:[{message:{content:JSON.stringify({text:'Full English report.'})}}],usage:{prompt_tokens:12,completion_tokens:5}};
 });
});
