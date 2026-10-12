"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import type {DicomSeries} from "../lib/dicom-series";
import {fullCtGeometry,prepareFullCtStream} from "../lib/full-ct-stream";
import {createFullCtReader} from "../lib/full-ct-decoder";
import {checkFullCtWorker,runFullCt,closeFullCt,fullCtReport,type FullCtTicket} from "../lib/full-ct-worker";
import {acquireBrowserCompute} from "../lib/browser-compute-slot";

export default function FullCtPanel({series,files,enabled,onBusy,onResult}: {
  series:DicomSeries;files:File[];enabled:boolean;onBusy:(busy:boolean)=>void;onResult:(ticket:FullCtTicket|null)=>void;
}) {
  const [token,setToken]=useState(""),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false);
  const [status,setStatus]=useState(""),[error,setError]=useState(""),[result,setResult]=useState<FullCtTicket|null>(null);
  const active=useRef<AbortController|null>(null),owned=useRef<FullCtTicket|null>(null),generation=useRef(0);
  const callbacks=useRef({onBusy,onResult});callbacks.current={onBusy,onResult};
  const clear=async()=>{const previous=owned.current;if(!previous)return;
    callbacks.current.onResult(null);setBusy(true);setError("");
    try{await closeFullCt(previous);if(owned.current===previous){owned.current=null;setResult(null);setStatus("Полное задание удалено.");}}
    catch{setError("Не удалось подтвердить удаление. Проверьте связь с worker и повторите удаление; TTL продолжает действовать.");}
    finally{setBusy(false);}
  };
  useEffect(()=>{const revision=++generation.current;setConfirmed(false);setError("");setStatus("");setResult(null);
    const onExit=()=>{++generation.current;active.current?.abort();const previous=owned.current;owned.current=null;
      if(previous)void closeFullCt(previous).catch(()=>{});};
    window.addEventListener("pagehide",onExit);
    return()=>{window.removeEventListener("pagehide",onExit);if(generation.current===revision)++generation.current;active.current?.abort();
      const previous=owned.current;owned.current=null;if(previous)void closeFullCt(previous).catch(()=>{});
      callbacks.current.onResult(null);};
  },[series]);
  const unsupported=useMemo(()=>{try{fullCtGeometry(series);return "";}catch(e){return e instanceof Error?e.message:"Геометрия полной КТ не поддерживается.";}},[series]);
  if(series.modality!=="CT")return null;
  const run=async()=>{
    if(busy||!enabled||unsupported||!confirmed||owned.current||files.length!==series.members.length)return;
    const revision=generation.current,controller=new AbortController();active.current=controller;
    setBusy(true);callbacks.current.onBusy(true);setError("");setStatus("Проверка локального worker…");
    let release:(()=>void)|undefined;
    try {
      release=acquireBrowserCompute("local-r231");
      const session={endpoint:"http://127.0.0.1:8765",token};await checkFullCtWorker(session,controller.signal);
      const read=await createFullCtReader(files);
      const packet=await prepareFullCtStream(series,read,controller.signal,n=>{
        if(revision===generation.current)setStatus(`Проверка и SHA полной КТ: ${n}/${series.members.length}`);
      });
      const ticket=await runFullCt(session,packet,controller.signal,text=>{if(revision===generation.current)setStatus(text);});
      if(revision!==generation.current||controller.signal.aborted){await closeFullCt(ticket);return;}
      owned.current=ticket;setResult(ticket);callbacks.current.onResult(ticket);setStatus("Полная загруженная серия обработана. Выберите фрагмент для просмотра маски в MPR.");
    }catch(e){if(revision===generation.current)setError(controller.signal.aborted?"Задание отменено; результат не подтверждён.":e instanceof Error?e.message:"Ошибка полной КТ.");}
    finally{release?.();if(active.current===controller)active.current=null;setBusy(false);callbacks.current.onBusy(false);}
  };
  const download=()=>{if(!result)return;const url=URL.createObjectURL(new Blob([JSON.stringify(fullCtReport(result),null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download="opus-full-ct-evidence.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),400);};
  return <details className="ora-ct-slab" aria-label="Полная КТ через локальный R231"><summary>Полная КТ · потоковый R231</summary>
    <p>{series.members.length} исходных срезов. Декодируется один срез за раз; полная маска остаётся на диске worker, в MPR загружается только выбранный диапазон.</p>
    <p>Исследовательский режим для открытой КТ грудной клетки. Это обработка всех загруженных кадров, не подтверждение полноты исследования или клинической точности.</p>
    {unsupported&&<p role="status">Полный поток недоступен: {unsupported}</p>}
    <label>Токен полного локального задания<input aria-label="Токен полного локального задания" type="password" autoComplete="off" value={token} disabled={busy||!!result} onChange={e=>setToken(e.target.value)}/></label>
    <label><input type="checkbox" checked={confirmed} disabled={busy||!!result} onChange={e=>setConfirmed(e.target.checked)}/> Подтверждаю открытую исследовательскую КТ грудной клетки в HU, без реальных пациентов.</label>
    <button type="button" disabled={!enabled||!!unsupported||busy||!confirmed||!token||!!result} onClick={()=>void run()}>Обработать всю КТ локально</button>
    {!enabled&&<p>Запуск доступен из 2D. Вернитесь из MPR, чтобы освободить объём.</p>}
    {busy&&<button type="button" onClick={()=>active.current?.abort()}>Отменить полную КТ</button>}
    {status&&<p role="status">{status}</p>}{error&&<p role="alert">{error}</p>}
    {result&&<><p>R231 · {result.request.frameCount} кадров · пик процесса {result.metrics.peakRssMiB.toFixed(1)} МиБ.
      Это RSS модели, не суммарная память Mac.</p><button type="button" onClick={download}>Скачать Evidence полной КТ</button>
      <button type="button" disabled={busy} onClick={()=>void clear()}>Удалить полное задание и маску</button>
      <p>Задание хранится до удаления, смены серии/закрытия страницы или TTL worker (30 минут от создания).</p></>}
  </details>;
}
