"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import type {DicomSeries} from "../lib/dicom-series";
import {
  planOriginalVolumeSource,prepareOriginalVolumeBatches,type VolumePreparedBatch,
} from "../lib/vision-volume-source";

/** No cloud calls: this control proves actual source-pixel decoding and local
 * OCR across the study, without a 103-image browser memory spike.
 */
export default function FullVolumeLocalPreparation({
  series,files,flaggedIndex,onOpenSlice,
}:{
  series:DicomSeries;
  files:ReadonlyMap<string,File>;
  flaggedIndex:number|null;
  onOpenSlice:(fileId:string)=>void;
}){
  const controller=useRef<AbortController|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const [progress,setProgress]=useState({batches:0,overview:0,targeted:0,unresolved:0});
  const [lastBatch,setLastBatch]=useState<VolumePreparedBatch|null>(null);
  const plan=useMemo(()=>{
    try{return planOriginalVolumeSource(series,{
      flaggedIndices:flaggedIndex===null?[]:[flaggedIndex],
    });}catch{return null;}
  },[series,flaggedIndex]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function prepare(){
    if(busy||!plan)return;
    const c=new AbortController();controller.current=c;
    setBusy(true);setNotice("Проверяем и последовательно декодируем исходные DICOM локально…");
    setProgress({batches:0,overview:0,targeted:0,unresolved:0});setLastBatch(null);
    let overview=0,targeted=0,unresolved=0,batches=0;
    try{
      for await(const current of prepareOriginalVolumeBatches(series,files,{
        signal:c.signal,
        flaggedIndices:flaggedIndex===null?[]:[flaggedIndex],
        onProgress:message=>{if(!c.signal.aborted)setNotice(message);},
      })){
        // Drop the preceding decoded batch before proceeding, so no complete
        // volume of images accumulates in React state.
        batches++;
        if(current.pass==="overview")overview+=current.sources.length;
        else targeted+=current.sources.length;
        unresolved+=current.privacy.unresolved;
        if(!c.signal.aborted){
          setLastBatch(current);
          setProgress({batches,overview,targeted,unresolved});
        }
      }
      if(!c.signal.aborted)setNotice(
        "Локальная OCR-подготовка завершена для "+overview+" из "+plan.sourceFrames.length+
        " оригинальных срезов; повторно обработано "+targeted+
        ". Обнаружено "+unresolved+" кадров с оставшимися OCR-надписями."+
        " Изображения не отправлялись в Gemini, врачебное разрешение не получено."
      );
    }catch(e){
      if(!c.signal.aborted)setNotice("Подготовка прервана: "+
        (e instanceof Error?e.message:"неизвестная ошибка")+
        ". Непроверенные кадры НЕ считаются обработанными.");
      else setNotice("Локальная подготовка отменена. Облачной передачи не было.");
    }finally{
      if(controller.current===c){controller.current=null;setBusy(false);}
    }
  }
  if(!plan)return <p role="status">Полный локальный обзор недоступен: требуется согласованная геометрия исходной КТ/МРТ.</p>;
  return <section aria-label="Реальная локальная подготовка всего DICOM-объёма">
    <p>Сквозная локальная подготовка {plan.sourceFrames.length} срезов:
      пакеты по 4, декодирование исходных DICOM, OCR и физическое скрытие найденных надписей.
      Передачи в облако и анализа Gemini/Opus на этом этапе нет.</p>
    <button type="button" disabled={busy} onClick={()=>void prepare()}>
      {busy?"Обрабатываем исходные DICOM…":"Подготовить весь объём локально"}
    </button>
    {busy&&<button type="button" onClick={()=>controller.current?.abort()}>Остановить локальную подготовку</button>}
    <p role="status">{notice}</p>
    <p>Подготовлено {progress.overview} / {plan.sourceFrames.length} оригинальных срезов;
      пакетных операций {progress.batches} из {plan.batches.length};
      прицельных повторов {progress.targeted}; неустранённых OCR-надписей {progress.unresolved}.</p>
    {lastBatch&&<details>
      <summary>Последний локально подготовленный пакет · {lastBatch.sources.length} кадра</summary>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {lastBatch.privacy.frames.map((frame,i)=><div key={lastBatch.sources[i].fileId}>
          <img src={"data:image/png;base64,"+frame.pngBase64}
            alt={"Локальная обезличенная копия среза "+(lastBatch.sources[i].index+1)}
            width={128}/>
          <p>Срез {lastBatch.sources[i].index+1}</p>
          <button type="button" onClick={()=>onOpenSlice(lastBatch.sources[i].fileId)}>
            Открыть исходный DICOM
          </button>
        </div>)}
      </div>
      <p>Этот пакет не проверен врачом и не разрешён к передаче. Все предыдущие
        пиксели удаляются из памяти компонента при переходе к следующему пакету.</p>
    </details>}
  </section>;
}
