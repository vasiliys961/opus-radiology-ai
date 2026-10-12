"use client";
import {useEffect,useState} from "react";
import type {DicomSeries} from "../lib/dicom-series";
import {maxCtSlabFrames,selectCtSlab} from "../lib/ct-slab";

export default function CtSlabSelection({series,fileSizes,selected,disabled,onSelect}: {
  series:DicomSeries;fileSizes:number[];selected:DicomSeries|null;disabled:boolean;
  onSelect:(series:DicomSeries|null)=>void;
}) {
  const maximum=maxCtSlabFrames(series);
  const [start,setStart]=useState("1"),[end,setEnd]=useState(String(maximum));
  const [error,setError]=useState("");
  useEffect(()=>{setStart("1");setEnd(String(maximum));setError("");},[series,maximum]);
  if(!maximum)return null;
  const apply=()=>{
    try{const slab=selectCtSlab(series,fileSizes,Number(start)-1,Number(end)-1);setError("");onSelect(slab);}
    catch(e){setError(e instanceof Error?e.message:"Не удалось выбрать фрагмент.");}
  };
  return <section className="ora-ct-slab" aria-label="Фрагмент КТ для MPR и локального AI">
    <strong>Фрагмент КТ · меньше памяти</strong>
    <p>Выберите 3–{maximum} последовательных срезов. Полная серия остаётся в 2D; MPR и локальный AI используют только этот диапазон.</p>
    <label>Первый срез <input aria-label="Первый срез фрагмента КТ" type="number" min={1} max={series.members.length}
      value={start} disabled={disabled} onChange={e=>setStart(e.target.value)}/></label>
    <label>Последний срез <input aria-label="Последний срез фрагмента КТ" type="number" min={1} max={series.members.length}
      value={end} disabled={disabled} onChange={e=>setEnd(e.target.value)}/></label>
    <button type="button" disabled={disabled} onClick={apply}>Открыть фрагмент в MPR</button>
    {selected&&<><p role="status">{selected.label}. Частичное покрытие: вне диапазона AI ничего не проверял.</p>
      <button type="button" onClick={()=>onSelect(null)}>Вернуть полную серию в 2D</button></>}
    {disabled&&<p>Перед сменой диапазона вернитесь в 2D. Текущая маска и незавершённое задание будут сброшены.</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
