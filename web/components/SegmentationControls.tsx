"use client";

import { useEffect, useRef, useState } from "react";
import { maskColor, readNiftiMaskFile, type LabelMask } from "../lib/segmentation-mask";

export type MaskDisplay = { visible: boolean; opacity: number; label: number | null };
type Summary = { name: string; labels: LabelMask["labels"] };

export default function SegmentationControls({ ready, onImport, onDisplay, onClear }: {
  ready: boolean;
  onImport: (mask: LabelMask, display: MaskDisplay) => void;
  onDisplay: (display: MaskDisplay) => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  const callbacks = useRef({ onImport, onDisplay, onClear });
  callbacks.current = { onImport, onDisplay, onClear };
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [display, setDisplay] = useState<MaskDisplay>({visible:true,opacity:0.4,label:null});

  useEffect(() => () => { version.current++; }, []);
  useEffect(() => {
    if (!ready) { version.current++; setSummary(null); setBusy(false); setError(""); }
  }, [ready]);

  const load = async (file: File) => {
    const request = ++version.current;
    setBusy(true); setError("");
    try {
      const mask = await readNiftiMaskFile(file);
      if (request !== version.current) return;
      const next = {visible:true,opacity:0.4,label:mask.labels[0]?.id??null};
      // Runtime validates physical geometry before replacing an existing overlay.
      callbacks.current.onImport(mask,next);
      setSummary({name:file.name,labels:mask.labels}); setDisplay(next);
    } catch(cause) {
      if (request === version.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (request === version.current) setBusy(false); }
  };
  const change = (next: MaskDisplay) => {
    try { callbacks.current.onDisplay(next);setDisplay(next);setError(""); }
    catch(cause) {setError(cause instanceof Error ? cause.message : String(cause));}
  };
  const selected = display.label===null ? null : summary?.labels.find(l=>l.id===display.label);
  const voxels = selected?.voxels ?? summary?.labels.reduce((n,l)=>n+l.voxels,0) ?? 0;
  const volumeMl = selected?.volumeMl ?? summary?.labels.reduce((n,l)=>n+l.volumeMl,0) ?? 0;

  return <section className="ora-mask-controls" aria-label="Готовая сегментационная маска">
    <div className="ora-mask-heading"><strong>Сегментация · готовая маска</strong><span>Локальный импорт</span></div>
    <p>Загрузите NIfTI-маску именно выбранной DICOM-серии. Проверяются размеры, положение и ориентация. Автоматическая нейросеть пока не подключена.</p>
    <div className="ora-mask-actions">
      <button type="button" disabled={!ready||busy} onClick={()=>input.current?.click()}>{busy ? "Проверка маски…" : summary ? "Заменить маску .nii / .nii.gz" : "Загрузить маску .nii / .nii.gz"}</button>
      {summary && <button type="button" onClick={()=>{
        version.current++; callbacks.current.onClear();setSummary(null);setBusy(false);setError("");
      }}>Удалить маску</button>}
      <input ref={input} type="file" accept=".nii,.nii.gz" hidden onChange={event=>{
        const file=event.target.files?.[0];event.target.value="";
        if(file&&ready)void load(file);
      }}/>
    </div>
    {error && <p className="ora-mask-error" role="alert">{error} {summary ? "Предыдущая маска сохранена." : "Маска не подключена."}</p>}
    {summary && <>
      <p className="ora-mask-success" role="status">Сетка совмещена · {summary.name} · меток: {summary.labels.length}</p>
      <small>Совпадение геометрии не подтверждает пациента или правильность сегментации. Проверьте принадлежность файла выбранной серии и границы на всех плоскостях.</small>
      {summary.labels.length ? <>
        <div className="ora-mask-settings">
          <label className="ora-mask-visible"><input type="checkbox" checked={display.visible} onChange={event=>change({...display,visible:event.target.checked})}/> Показать на MPR</label>
          <label>Метка<select value={display.label??"all"} onChange={event=>change({...display,label:event.target.value==="all" ? null : Number(event.target.value)})}>
            <option value="all">Все метки</option>
            {summary.labels.map(l=><option value={l.id} key={l.id}>Метка {l.id} · {l.voxels.toLocaleString("ru-RU")} вокселей</option>)}
          </select></label>
          <label>Непрозрачность: {Math.round(display.opacity*100)}%<input type="range" min="0" max="80" value={Math.round(display.opacity*100)} onChange={event=>change({...display,opacity:Number(event.target.value)/100})}/></label>
        </div>
        <p className="ora-mask-quantification">{selected && <i aria-hidden="true" style={{background:`rgb(${maskColor(selected.id).join(",")})`}}/>}{selected ? `Метка ${selected.id}` : "Все метки"}: {voxels.toLocaleString("ru-RU")} вокселей · объём разметки ≈ {volumeMl.toFixed(3)} мл.</p>
        <small>Объём рассчитан по меткам и геометрии маски; это не оценка точности модели. Названия анатомических структур не назначаются без словаря модели. Маска отображается поверх MPR, без 3D-поверхностей.</small>
      </> : <p>Маска не содержит ненулевых меток. Это не подтверждает отсутствие патологических изменений.</p>}
    </>}
  </section>;
}
