"use client";
import { useEffect, useRef, useState } from "react";
import { checkLocalWorker, runLocalR231, type WorkerMetrics } from "../lib/local-worker";
import type { AnalysisStream } from "../lib/analysis-stream";
import type { SegmentationResult } from "../lib/analysis-package";
import type { LabelMask } from "../lib/segmentation-mask";
import type { SegmentationEvidence } from "../lib/segmentation-evidence";
import { acquireBrowserCompute } from "../lib/browser-compute-slot";

export default function LocalLungmaskPanel({ready, onPrepare, onResult, onBusy}: {
  ready: boolean; onPrepare: (signal: AbortSignal)=>Promise<AnalysisStream>;
  onResult: (mask: LabelMask,result: SegmentationResult,evidence: SegmentationEvidence)=>void; onBusy: (busy: boolean)=>void;
}) {
  const [endpoint,setEndpoint]=useState("http://127.0.0.1:8765");
  const [token,setToken]=useState("");
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("");
  const [error,setError]=useState("");
  const [metrics,setMetrics]=useState<WorkerMetrics|null>(null);
  const [profile,setProfile]=useState<"safe"|"balanced"|undefined>();
  const active=useRef<AbortController|null>(null);
  const callbacks=useRef({onPrepare,onResult,onBusy});callbacks.current={onPrepare,onResult,onBusy};
  useEffect(()=>()=>{active.current?.abort();},[]);
  useEffect(()=>{if(!ready){active.current?.abort();setStatus("");setMetrics(null);}},[ready]);
  const run=async()=>{
    const controller=new AbortController();active.current=controller;
    setBusy(true);callbacks.current.onBusy(true);setError("");setMetrics(null);setProfile(undefined);
    const session={endpoint,token};
    let release:(()=>void)|undefined;
    try {
      release=acquireBrowserCompute("local-r231");
      setStatus("Проверка локальной модели…");
      setProfile(await checkLocalWorker(session,controller.signal));
      setStatus("Проверка скалярных данных выбранной серии…");
      const packet=await callbacks.current.onPrepare(controller.signal);
      const output=await runLocalR231(session,packet,controller.signal,setStatus);
      if(controller.signal.aborted)return;
      callbacks.current.onResult(output.mask,output.result,output.evidence);
      setMetrics(output.metrics);setStatus("Правое и левое лёгкое выделены цветом. Проверьте границы на аксиальных, корональных и сагиттальных срезах.");
    } catch(cause) {
      if(controller.signal.aborted)setStatus("Ожидание отменено; запрос удаления отправлен worker. При потере связи файлы удаляются по TTL.");
      else {setStatus("");setError(cause instanceof Error?cause.message:"Локальное задание не выполнено.");}
    } finally {
      release?.();
      if(active.current===controller){active.current=null;setBusy(false);callbacks.current.onBusy(false);}
    }
  };
  return <details className="ora-local-lungmask">
    <summary>Выделить правое и левое лёгкое на КТ</summary>
    <p>Модель Lungmask R231 выделяет лёгкие цветом на исходных срезах и позволяет оценить объём выделенной области. Она не ищет узлы или опухоли и не формирует заключение. Обработка выполняется на этом компьютере, без облачных моделей.</p>
    <p>Обрабатывается только загруженная серия или выбранный фрагмент. При неподходящей геометрии или нехватке памяти обработка не начнётся. Границы лёгких необходимо проверить врачу.</p>
    {profile&&<p>Профиль текущего worker: {profile === "safe" ? "Safe Mode · 1 поток" : "Balanced · 2 потока"}.</p>}
    <p>Если локальная обработка ещё не подключена, эти настройки заполняет специалист по установке.
      <a href="https://github.com/vasiliys961/opus-radiology-ai/blob/main/docs/LOCAL_LUNGMASK_WORKER.md" target="_blank" rel="noreferrer"> Инструкция для специалиста</a></p>
    <label>Адрес локальной службы обработки <input aria-label="Адрес локального worker" value={endpoint} disabled={busy} onChange={e=>setEndpoint(e.target.value)}/></label>
    <label>Код доступа к локальной службе <input aria-label="Токен локального worker" type="password" autoComplete="off" value={token} disabled={busy} onChange={e=>setToken(e.target.value)}/></label>
    <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/> Это разрешённая открытая исследовательская КТ грудной клетки; полный поперечный срез и HU проверены. Не клиническое исследование пациента.</label>
    <div className="ora-mask-actions">
      <button type="button" disabled={!ready||busy||!confirmed||!token} onClick={()=>void run()}>Сегментировать лёгкие локально</button>
      {error&&<button type="button" disabled={!ready||busy||!confirmed||!token} onClick={()=>void run()}>Повторить R231</button>}
      {busy&&<button type="button" onClick={()=>active.current?.abort()}>Отменить R231</button>}
    </div>
    {status&&<p role="status">{status}</p>}
    {error&&<p className="ora-local-worker-error ora-package-error" role="alert">{error}</p>}
    {metrics&&<p className="ora-local-worker-metrics">Измерено на {metrics.platform} / {metrics.machine}: инференс {metrics.inferenceSeconds.toFixed(2)} с; адаптер {metrics.totalSeconds.toFixed(2)} с; пик RSS {metrics.peakRssMiB.toFixed(1)} МиБ. CPU, batch 1. Эти показатели относятся к процессу модели; память браузера измеряется отдельно.</p>}
    {metrics?.preflight&&<p>Preflight перед инференсом: доступно {(metrics.preflight.availableRamBytes/1024**3).toFixed(2)} ГиБ RAM, требуется {(metrics.preflight.requiredRamBytes/1024**3).toFixed(2)} ГиБ. Guard: {metrics.guardDecision}.</p>}
    <small>Токен хранится только в памяти вкладки. Данные идут прямо на 127.0.0.1; временные файлы удаляются после задания, отмены или TTL. Облачный patient gate остаётся закрыт. Полный режим пациентов и серверы ещё не допущены.</small>
  </details>;
}
