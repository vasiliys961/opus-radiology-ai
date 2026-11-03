"use client";
import {useEffect,useMemo,useState} from 'react';
import type {DicomSeries} from '../lib/dicom-series';
import {matchMrSourcePlane,sameMrStudy} from '../lib/mr-series-comparison';
import {decodeDicomPreview} from '../lib/dicom-lite';
import {MAX_PRIVACY_PIXELS} from '../lib/vision-privacy';
export default function MrSeriesComparison({series,allSeries,files,onOpenSlice}:{series:DicomSeries;allSeries:readonly DicomSeries[];files:ReadonlyMap<string,File>;onOpenSlice:(id:string)=>void}){
 const candidates=useMemo(()=>allSeries.filter(s=>sameMrStudy(series,s)),[allSeries,series]);
 const [open,setOpen]=useState(false),[choice,setChoice]=useState(''),[index,setIndex]=useState(0);
 const [pictures,setPictures]=useState<string[]>([]),[notice,setNotice]=useState('');
 const companion=candidates.find(s=>s.key===choice)??candidates[0];
 const match=useMemo(()=>companion?matchMrSourcePlane(series,index,companion):null,[series,index,companion]);
 useEffect(()=>{
  const c=new AbortController();setPictures([]);
  if(!open||!companion||match?.status!=='matched')return()=>c.abort();
  setNotice('Готовим два исходных среза локально…');
  void (async()=>{
   const urls:string[]=[];
   for(const member of [series.members[index],companion.members[match.referenceIndex]]){
    c.signal.throwIfAborted();const file=files.get(member.id);
    if(!file||file.size>6*1024*1024)throw Error('Исходный файл недоступен или превышает размер локальной копии.');
    try{urls.push((await decodeDicomPreview(file,{maxPixels:MAX_PRIVACY_PIXELS})).url);}
    catch{const {decodeCornerstoneVisionPreview}=await import('../lib/cornerstone-vision-preview');urls.push(await decodeCornerstoneVisionPreview(file,MAX_PRIVACY_PIXELS,c.signal));}
   }
   c.signal.throwIfAborted();setPictures(urls);setNotice('Ближайшие параллельные срезы. Это не регистрация изображений; проверьте соответствие анатомии.');
  })().catch(e=>{if(!c.signal.aborted)setNotice(e instanceof Error?e.message:'Не удалось подготовить сравнение.');});
  return()=>c.abort();
 },[open,series,companion,index,match,files]);
 if(series.modality!=='MR')return null;
 return <section aria-label="Локальное сравнение МР-серий"><h3>Сопоставление МР-серий</h3>
  <p>Других серий этого исследования: {candidates.length}. Типы T1, T2, FLAIR, DWI и ADC автоматически не подтверждены. Один выбранный ряд не заменяет полный МР-протокол. Сравнение с предыдущим исследованием не выполнено.</p>
  {candidates.length>0&&<>
   <button type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?'Закрыть сравнение МР-серий':'Сравнить МР-серии рядом'}</button>
   {open&&<>
    <label>Серия для сравнения <select value={companion?.key} onChange={e=>setChoice(e.target.value)}>{candidates.map((s,i)=><option key={s.key} value={s.key}>МР-серия {i+1} · {s.members.length} срезов</option>)}</select></label>
    <label>Срез основной серии <input type="range" min={0} max={series.members.length-1} value={index} onChange={e=>setIndex(Number(e.target.value))}/>{index+1}</label>
    {match?.status==='unavailable'?<p role="status">{match.reason}</p>:<>
     <p role="status">{notice} {match?.status==='matched'&&'Расстояние между плоскостями: '+match.distanceMm.toFixed(2)+' мм.'}</p>
     <div style={{display:'flex',flexWrap:'wrap',gap:12}}>{pictures.map((url,i)=>{
      const s=i===0?series:companion!,n=i===0?index:match!.status==='matched'?match!.referenceIndex:0,m=s.members[n].metadata;
      return <figure key={i} style={{margin:0}}><img src={url} width={320} height={320} style={{objectFit:'contain'}} alt={i===0?'Основная МР-серия':'Сопоставляемая МР-серия'}/>
       <figcaption><button type="button" onClick={()=>onOpenSlice(s.members[n].id)}>Открыть оригинал · срез {n+1}</button><p>TR: {m.repetitionTimeMs??'не определено'} мс; TE: {m.echoTimeMs??'не определено'} мс. Взвешенность не подтверждена.</p></figcaption></figure>;
     })}</div>
    </>}
    <p>Сравнение выполняется только локально. Эти дополнительные серии автоматически в ИИ не отправляются и не входят в счётчик его охвата.</p>
   </>}
  </>}
 </section>;
}
