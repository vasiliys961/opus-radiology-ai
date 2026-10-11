"use client";
import { useEffect, useRef, useState } from "react";
import { checkLocalWorker, runLocalR231, type WorkerMetrics } from "../lib/local-worker";
import type { AnalysisStream } from "../lib/analysis-stream";
import type { SegmentationResult } from "../lib/analysis-package";
import type { LabelMask } from "../lib/segmentation-mask";
import type { SegmentationEvidence } from "../lib/segmentation-evidence";

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
    try {
      setStatus("Проверка локальной модели…");
      setProfile(await checkLocalWorker(session,controller.signal));
      setStatus("Проверка скалярных данных выбранной серии…");
      const packet=await callbacks.current.onPrepare(controller.signal);
      const output=await runLocalR231(session,packet,controller.signal,setStatus);
      if(controller.signal.aborted)return;
      callbacks.current.onResult(output.mask,output.result,output.evidence);
      setMetrics(output.metrics);setStatus("Маска возвращена в MPR. Проверьте границы на всех плоскостях.");
    } catch(cause) {
      if(controller.signal.aborted)setStatus("Ожидание отменено; запрос удаления отправлен worker. При потере связи файлы удаляются по TTL.");
      else {setStatus("");setError(cause instanceof Error?cause.message:"Локальное задание не выполнено.");}
    } finally {
      if(active.current===controller){active.current=null;setBusy(false);callbacks.current.onBusy(false);}
    }
  };
  return <details className="ora-local-lungmask">
    <summary>Lungmask R231 · локальный CPU · экспериментальный режим</summary>
    <p>КТ грудной клетки → маска правого и левого лёгкого → MPR. Обрабатывает отдельный Python worker на этом компьютере. Gemini/Claude для этой задачи не требуются.</p>
    <p>До 8 388 608 вокселей; только осевая сетка без наклона. Большие серии будут отклонены. Это сегментация, диагностическое заключение не формируется.</p>
    <p>Safe Mode включён по умолчанию в обновлённом worker: CPU, один поток, batch 1; расчёт памяти по серии и остановка при нехватке ресурсов. Это экспериментальная оценка, не гарантия отсутствия swap.</p>
    {profile&&<p>Профиль текущего worker: {profile === "safe" ? "Safe Mode · 1 поток" : "Balanced · 2 потока"}.</p>}
    <p><a href="https://github.com/vasiliys961/opus-radiology-ai/blob/main/docs/LOCAL_LUNGMASK_WORKER.md" target="_blank" rel="noreferrer">Установка и запуск worker</a></p>
    <label>Адрес worker <input aria-label="Адрес локального worker" value={endpoint} disabled={busy} onChange={e=>setEndpoint(e.target.value)}/></label>
    <label>Сессионный токен <input aria-label="Токен локального worker" type="password" autoComplete="off" value={token} disabled={busy} onChange={e=>setToken(e.target.value)}/></label>
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
