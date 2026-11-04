"use client";
import {useEffect,useRef,useState} from 'react';
import {autoPrepareVisionPrivacy,type AutomaticPrivacyPreparation} from '../lib/auto-privacy-preparation';
import {type VisionPrivacyPacket} from '../lib/vision-privacy';
import {reviewPreparedStudy} from '../lib/review-prepared-study';
import VisionPrivacyPreparation from './VisionPrivacyPreparation';

// Compressed copies only, ephemeral tab memory. No IndexedDB, disk or source DICOM copy.
const MAX_REVIEW_MEMORY=96*1024*1024;
export default function StudyPrivacyReview({count,modality,load,onReady,onOpenSlice,sourceIds,sourceNumbers,clinicalContext,canRelease=false,releaseNotice,windows}:{
 clinicalContext?:string;sourceNumbers?:number[][];canRelease?:boolean;releaseNotice?:string;count:number;modality:'CT'|'MR';load:(index:number,signal:AbortSignal)=>Promise<string[]>;
 onReady:(packets:VisionPrivacyPacket[])=>Promise<void>;onOpenSlice:(id:string)=>void;sourceIds:string[][];
 windows?:{primary:string;additional?:string;separateAfter?:number};
}){
 const [expanded,setExpanded]=useState<number|null>(null);
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
    prepared.push(group);setGroups(prepared.slice());
    setNotice('Готово групп: '+prepared.length+' из '+count+'. Уже можно смотреть копии. Отправка начнётся только после всех групп и отдельного разрешения.');
   }
   c.signal.throwIfAborted();setNotice('Подготовка завершена. Просмотрите копии и разберите отмеченные кадры. Затем разрешите отправку всей серии один раз.');
  })().catch(e=>{if(!c.signal.aborted)setError(e instanceof Error?e.message:'Подготовка не завершена.');})
   .finally(()=>{if(!c.signal.aborted)setPreparing(false);});
  return()=>{c.abort();};
 // The owning analysis mounts a new review for each source selection.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[attempt]);
 const suspects=groups.flatMap((g,i)=>g.unresolved>0&&!resolved.has(i)?[i]:[]);
 const group=groups[index];
 async function release(){
  if(!canRelease||!approved||preparing||error||started.current||groups.length!==count)return;
  started.current=true;setSending(true);
  try{
   // This is the physician's ONE explicit attestation of these exact copies,
   // not an inference from OCR absence or thumbnail loading.
   const reviewed=reviewPreparedStudy(groups,approved);
   setGroups(previous=>previous.map((g,i)=>({...g,journal:reviewed[i].journal,frames:reviewed[i].packet.frames})));
   await onReady(reviewed.map(g=>g.packet));
  }catch(e){setError(e instanceof Error?e.message:'Анализ не завершён.');}
  finally{setSending(false);}
 }
 return <section aria-label="Проверка всей серии перед отправкой">
  <p role="status">{notice}</p>{error&&<p role="alert">{error}</p>}
  {error&&!preparing&&!started.current&&<button type="button" onClick={()=>setAttempt(n=>n+1)}>Повторить локальную подготовку</button>}
  {preparing&&<button type="button" onClick={()=>{cancel.current?.abort();setPreparing(false);setError('Подготовка остановлена. Изображения не отправлялись.');}}>Отменить подготовку</button>}
  {group&&!sending&&<>
   <p>Нажмите на изображение, чтобы проверить его в полном размере. Миниатюра с двумя окнами может выглядеть слишком мелкой. Жёлтые рамки — предполагаемые надписи, они не меняют контраст снимка.</p>
   {windows&&<p>{windows.separateAfter!==undefined&&windows.additional?(index<windows.separateAfter?`Окно этой группы: ${windows.primary}. Те же срезы дальше идут отдельно в окне «${windows.additional}».`:`Окно этой группы: ${windows.additional}. Номера те же, это не новые срезы.`):windows.additional?`Слева: ${windows.primary}. Справа: ${windows.additional}. Это один и тот же срез.`:`Окно копии: ${windows.primary}.`}</p>}
   <p>Наборов с отметками OCR для проверки: {suspects.length}. OCR может пропустить текст и не проверяет узнаваемое лицо. Изображения автоматически не закрашиваются.</p>
   <label>Просмотр срезов <input aria-label="Группа срезов для просмотра" type="range" min={0} max={groups.length-1} value={index}
    onChange={e=>{setIndex(Number(e.target.value));setExpanded(null);setEditing(false);setApproved(false);}}/> {sourceNumbers?.[index]?.join(', ')??(index*4+1)+'–'+(index*4+group.frames.length)}</label>
   <div style={{display:'flex',flexWrap:'wrap',gap:8}}>{group.frames.map((f,i)=><figure key={f.frameId} style={{margin:0}}>
    <button type="button" onClick={()=>setExpanded(i)} aria-label="Открыть копию в полном размере" style={{display:'block',padding:0}}><div style={{position:'relative',width:256,height:256*f.height/f.width}}>
     <img src={'data:image/png;base64,'+f.pngBase64} width={256} height={256*f.height/f.width} alt={'Копия среза '+(sourceNumbers?.[index]?.[i]??index*4+i+1)}/>
     {group.ocr[f.frameId]?.sha256===f.sha256&&group.ocr[f.frameId].regions.map((r,n)=><span key={n} aria-hidden="true" style={{position:'absolute',pointerEvents:'none',border:'1px solid #f59e0b',left:100*r.rectangle.x/f.width+'%',top:100*r.rectangle.y/f.height+'%',width:100*r.rectangle.width/f.width+'%',height:100*r.rectangle.height/f.height+'%'}}/>)}
    </div></button>
    <figcaption><button type="button" onClick={()=>onOpenSlice(sourceIds[index][i])}>Исходный срез {sourceNumbers?.[index]?.[i]??index*4+i+1}</button></figcaption>
   </figure>)}</div>
   {expanded!==null&&group.frames[expanded]&&<section aria-label="Копия для ИИ в полном размере"><button type="button" onClick={()=>setExpanded(null)}>Закрыть полный размер</button><div style={{overflow:'auto',maxHeight:'75vh'}}><img style={{maxWidth:'none'}} src={'data:image/png;base64,'+group.frames[expanded].pngBase64} width={group.frames[expanded].width} height={group.frames[expanded].height} alt="Точная подготовленная копия для ИИ, без изменения яркости при просмотре"/></div></section>}
   {suspects.length>0&&<button type="button" onClick={()=>{setIndex(suspects[0]);setEditing(true);setApproved(false);}}>Разобрать кадры с возможными надписями</button>}
   <button type="button" onClick={()=>{setEditing(v=>!v);setApproved(false);}}>Скрыть данные или проверить надписи на этих кадрах</button>
   {editing&&<VisionPrivacyPreparation key={index} previews={group.frames.map(f=>'data:image/png;base64,'+f.pngBase64)} modality={modality}
    originalLocalFileIds={sourceIds[index]} onOpenOriginalSlice={onOpenSlice} initialPreparation={group} reviewedBatchLabel="Сохранить проверку этих кадров"
    onReviewedBatch={async (packet,preparation)=>{
     if(!preparation)throw Error('Не сохранена история проверки кадров.');
     setGroups(previous=>previous.map((g,i)=>i===index?{...preparation,frames:packet.frames}:g));
     setResolved(previous=>new Set([...previous,index]));setApproved(false);setEditing(false);
    }}/> }
   {preparing&&<p role="status">Кнопка отправки пока не нажимается: остальные группы ещё готовятся локально. Она появится после всех выбранных срезов и отметки проверки.</p>}
   {!preparing&&clinicalContext&&<p style={{whiteSpace:'pre-wrap'}}>Клинические данные для передачи: {clinicalContext}</p>}
   {!preparing&&releaseNotice&&<p>{releaseNotice}</p>}
   {!preparing&&!canRelease&&<p role="status">Передача недоступна: подключите разрешённое рабочее место. Копии остаются локально.</p>}
   {!preparing&&groups.length===count&&!error&&<>
    <label><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/>
     Я просмотрел выбранные подготовленные копии и клинический текст, включая все отметки OCR: идентифицирующих надписей и узнаваемых признаков нет; оставшиеся отметки — ложные срабатывания или неидентифицирующий текст. Имею право передачи и проверил условия обработки медицинских данных. Разрешаю отправить эту серию для анализа.</label>
    <button type="button" disabled={!canRelease||!approved} onClick={()=>void release()}>Отправить всю проверенную серию в анализ</button>
   </>}
  </>}
 </section>;
}
