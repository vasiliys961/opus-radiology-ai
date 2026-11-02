"use client";
import {useEffect,useRef,useState} from 'react';
import {autoPrepareVisionPrivacy,type AutomaticPrivacyPreparation} from '../lib/auto-privacy-preparation';
import {buildVisionPrivacyPacket,markPrivacyReview,type VisionPrivacyPacket} from '../lib/vision-privacy';
import {createPrivacyJournal} from '../lib/privacy-review-journal';
import VisionPrivacyPreparation from './VisionPrivacyPreparation';

// Compressed copies only, ephemeral tab memory. No IndexedDB, disk or source DICOM copy.
const MAX_REVIEW_MEMORY=96*1024*1024;
export default function StudyPrivacyReview({count,modality,load,onReady,onOpenSlice,sourceIds}:{
 count:number;modality:'CT'|'MR';load:(index:number,signal:AbortSignal)=>Promise<string[]>;
 onReady:(packets:VisionPrivacyPacket[])=>Promise<void>;onOpenSlice:(id:string)=>void;sourceIds:string[][];
}){
 const [groups,setGroups]=useState<AutomaticPrivacyPreparation[]>([]),[index,setIndex]=useState(0);
 const [notice,setNotice]=useState(''),[preparing,setPreparing]=useState(true),[error,setError]=useState('');
 const [resolved,setResolved]=useState<Set<number>>(new Set()),[editing,setEditing]=useState(false);
 const [approved,setApproved]=useState(false),[sending,setSending]=useState(false);
 const [attempt,setAttempt]=useState(0);
 const cancel=useRef<AbortController|null>(null),started=useRef(false);
 useEffect(()=>{
  const c=new AbortController();cancel.current=c;started.current=false;
  setGroups([]);setResolved(new Set());setApproved(false);setPreparing(true);setError('');
  void (async()=>{
   const prepared:AutomaticPrivacyPreparation[]=[];let bytes=0;
   for(let i=0;i<count;i++){
    c.signal.throwIfAborted();setNotice('Локальная подготовка и поиск надписей: группа '+(i+1)+' из '+count+'. Ничего не отправляется.');
    const urls=await load(i,c.signal);
    const group=await autoPrepareVisionPrivacy(urls,modality,c.signal,()=>{},{autoRedact:false});
    c.signal.throwIfAborted();
    bytes+=group.frames.reduce((n,f)=>n+f.pngBase64.length*2,0);
    if(bytes>MAX_REVIEW_MEMORY)throw Error('Копии превысили безопасный объём памяти предварительного просмотра. Уменьшите выбранную серию; отправка не началась.');
    prepared.push(group);
   }
   c.signal.throwIfAborted();setGroups(prepared);setNotice('Подготовка завершена. Просмотрите копии и разберите отмеченные кадры. Затем разрешите отправку всей серии один раз.');
  })().catch(e=>{if(!c.signal.aborted)setError(e instanceof Error?e.message:'Подготовка не завершена.');})
   .finally(()=>{if(!c.signal.aborted)setPreparing(false);});
  return()=>{c.abort();};
 // The owning analysis mounts a new review for each source selection.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[attempt]);
 const suspects=groups.flatMap((g,i)=>g.unresolved>0&&!resolved.has(i)?[i]:[]);
 const group=groups[index];
 async function release(){
  if(!approved||suspects.length||preparing||error||started.current||groups.length!==count)return;
  started.current=true;setSending(true);
  try{
   // This is the physician's ONE explicit attestation of these exact copies,
   // not an inference from OCR absence or thumbnail loading.
   const packets=groups.map(g=>buildVisionPrivacyPacket(g.frames.map(f=>
    markPrivacyReview(markPrivacyReview(f,'pixel',true),'visual',true)),crypto.randomUUID()));
   await onReady(packets);
  }catch(e){setError(e instanceof Error?e.message:'Анализ не завершён.');}
  finally{setSending(false);}
 }
 return <section aria-label="Проверка всей серии перед отправкой">
  <p role="status">{notice}</p>{error&&<p role="alert">{error}</p>}
  {error&&!preparing&&!started.current&&<button type="button" onClick={()=>setAttempt(n=>n+1)}>Повторить локальную подготовку</button>}
  {preparing&&<button type="button" onClick={()=>{cancel.current?.abort();setPreparing(false);setError('Подготовка остановлена. Изображения не отправлялись.');}}>Отменить подготовку</button>}
  {!preparing&&group&&!sending&&<>
   <p>Наборов с возможными надписями осталось: {suspects.length}. OCR может пропустить текст и не проверяет узнаваемое лицо. Изображения автоматически не закрашиваются.</p>
   <label>Просмотр срезов <input aria-label="Группа срезов для просмотра" type="range" min={0} max={groups.length-1} value={index}
    onChange={e=>{setIndex(Number(e.target.value));setEditing(false);setApproved(false);}}/> {index*4+1}–{index*4+group.frames.length}</label>
   <div style={{display:'flex',flexWrap:'wrap',gap:8}}>{group.frames.map((f,i)=><figure key={f.frameId} style={{margin:0}}>
    <img src={'data:image/png;base64,'+f.pngBase64} width={256} height={256} style={{objectFit:'contain'}} alt={'Копия среза '+(index*4+i+1)}/>
    <figcaption><button type="button" onClick={()=>onOpenSlice(sourceIds[index][i])}>Исходный срез {index*4+i+1}</button></figcaption>
   </figure>)}</div>
   {suspects.length>0&&<button type="button" onClick={()=>{setIndex(suspects[0]);setEditing(true);setApproved(false);}}>Разобрать кадры с возможными надписями</button>}
   <button type="button" onClick={()=>{setEditing(v=>!v);setApproved(false);}}>Скрыть данные или проверить надписи на этих кадрах</button>
   {editing&&<VisionPrivacyPreparation key={index} previews={group.frames.map(f=>'data:image/png;base64,'+f.pngBase64)} modality={modality}
    originalLocalFileIds={sourceIds[index]} onOpenOriginalSlice={onOpenSlice} initialPreparation={group} reviewedBatchLabel="Сохранить проверку этих кадров"
    onReviewedBatch={async packet=>{
     setGroups(previous=>previous.map((g,i)=>i===index?{...g,frames:packet.frames,journal:createPrivacyJournal(packet.frames,crypto.randomUUID(),new Date().toISOString())}:g));
     setResolved(previous=>new Set([...previous,index]));setApproved(false);setEditing(false);
    }}/> }
   <label><input type="checkbox" disabled={suspects.length>0} checked={approved} onChange={e=>setApproved(e.target.checked)}/>
    Я просмотрел подготовленные копии всей серии: идентифицирующих надписей и узнаваемых признаков нет. Разрешаю отправить эту серию для анализа.</label>
   <button type="button" disabled={!approved||suspects.length>0||!!error} onClick={()=>void release()}>Отправить всю проверенную серию в анализ</button>
  </>}
 </section>;
}
