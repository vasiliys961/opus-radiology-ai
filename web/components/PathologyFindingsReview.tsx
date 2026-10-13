"use client";
import {useState} from "react";
import {
  startPathologyReview, recordPathologyAssessment, setPathologySynthesis,
  type MonaiResearchReport, type PathologyAssessment, type PathologyFinding,
  type PathologyReviewDraft,
} from "../lib/pathology-findings";

const decisionLabels = {
  unreviewed: "Не оценён",
  needs_image_review: "Требуется проверка по исходным срезам",
  rejected_by_reviewer: "Отклонён рецензентом (без подтверждения изображения)",
} as const;
function updated(p:PathologyAssessment, change:Partial<PathologyAssessment>):PathologyAssessment{
  return {...p,...change};
}
function changed(a:PathologyAssessment,b:PathologyAssessment):boolean{
  return a.decision!==b.decision||a.note!==b.note||
    a.reviewerMeasuredDiameterMm!==b.reviewerMeasuredDiameterMm;
}
function downloadDraft(draft:PathologyReviewDraft){
  const data=JSON.stringify(draft,null,2);
  const blob=new Blob([data],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download="opus-pathology-luna16-physician-research-draft.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function ReviewRow({finding,editing,onChange,onSave}:{
  finding:PathologyFinding;
  editing:PathologyAssessment;
  onChange:(p:PathologyAssessment)=>void;
  onSave:()=>void;
}){
  const isDirty=changed(editing,finding.assessment);
  return <fieldset style={{padding:12,border:"1px solid #80968c",borderRadius:8,margin:"12px 0"}}>
    <legend><strong>Кандидат {finding.candidateIndex+1} — врачебная оценка</strong></legend>
    <p>Предложение MONAI: {finding.localization.modelBoundingBoxMm.map(n=>n.toFixed(1)).join(" × ")} мм
      {" · "}score {finding.model.rawUncalibratedScore.toFixed(3)} (некалиброванная оценка).</p>
    <p>Координаты модели: {finding.localization.modelWorldCenterMm.map(n=>n.toFixed(2)).join(" / ")} мм.
      Нет проверенных DICOM LPS и SOP UID.</p>
    <label>Статус врача
      <select value={editing.decision} onChange={e=>
        onChange(updated(editing,{decision:e.target.value as PathologyAssessment["decision"]}))}>
        {Object.entries(decisionLabels).map(([key,label])=>
          <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
    <label style={{display:"block",marginTop:8}}>Диаметр, измеренный врачом по исходному изображению (мм), если доступен
      <input type="number" min="0.1" max="300" step="0.1"
        value={editing.reviewerMeasuredDiameterMm??""}
        placeholder="Не измерен" onChange={e=>{
          const number=e.target.value===""?null:Number(e.target.value);
          onChange(updated(editing,{reviewerMeasuredDiameterMm:number}));
        }}/>
    </label>
    <p><small>Размеры бокса модели нельзя считать измерением врача. Ручное значение не подтверждается автоматически.</small></p>
    <label style={{display:"block"}}>Комментарий / дифференциальные соображения врача
      <textarea maxLength={1500} rows={2} style={{display:"block",width:"100%"}}
        value={editing.note} onChange={e=>onChange(updated(editing,{note:e.target.value}))}
        placeholder="Что требуется проверить на исходных срезах; без автоматической постановки диагноза"/>
    </label>
    <button type="button" disabled={!isDirty} onClick={onSave}>
      {isDirty?"Сохранить оценку в локальном журнале":"Оценка сохранена"}
    </button>
    <p><small>Текущая запись: {decisionLabels[finding.assessment.decision]}.</small></p>
  </fieldset>;
}

/** Medical review is local and source-bound, intentionally separate from the MONAI model output. */
export default function PathologyFindingsReview({report}:{report:MonaiResearchReport}){
  const [draft,setDraft]=useState(()=>startPathologyReview(report));
  const [pending,setPending]=useState<Record<string,PathologyAssessment>>({});
  const [synthesis,setSynthesis]=useState("");
  const [error,setError]=useState("");
  const [exportMessage,setExportMessage]=useState("");
  const dirty=draft.findings.some(f=>pending[f.findingId]&&changed(pending[f.findingId],f.assessment));
  const reviewed=draft.findings.filter(f=>f.assessment.decision!=="unreviewed").length;
  function save(f:PathologyFinding){
    try{
      const proposal=pending[f.findingId];
      if(!proposal)return;
      const recorded=recordPathologyAssessment(draft,f.findingId,proposal,new Date().toISOString());
      setDraft(recorded);
      setPending(current=>{
        const next={...current};delete next[f.findingId];return next;
      });
      setError("");setExportMessage("");
    }catch(err){setError(err instanceof Error?err.message:"Не удалось сохранить оценку.");}
  }
  function exportLocal(){
    setError("");setExportMessage("");
    if(dirty){setError("Сначала сохраните изменения в оценках каждого кандидата.");return;}
    try{
      const complete=setPathologySynthesis(draft,synthesis);
      downloadDraft(complete);
      setExportMessage("Исследовательский JSON-черновик сформирован локально. Он не подписан и не отправлен в облако.");
    }catch(err){setError(err instanceof Error?err.message:"Ошибка экспорта.");}
  }
  return <section aria-label="Врачебный разбор патологических находок"
    style={{border:"1px solid #789085",borderRadius:10,padding:12,marginTop:16}}>
    <h4>Врачебный разбор · патологические кандидаты</h4>
    <p>Ни один кандидат не подтверждён автоматически. Сохранённые решения относятся только к данному публичному результату MONAI, а не к загруженной КТ пациента.</p>
    <p><strong>Просмотрено: {reviewed}/{draft.findings.length}</strong>
      {" · "}Изменений в журнале: {draft.events.length}
      {" · "}Покрытие: только задача поиска лёгочных узлов.</p>
    <p role="alert">Пока исходная КТ не связана с координатами модели и SOP UID, нельзя отметить находку как клинически подтверждённую. Для этого нужен просмотр исходных пикселей.</p>
    {draft.findings.map(f=>
      <ReviewRow key={f.findingId} finding={f} editing={pending[f.findingId]??f.assessment}
        onChange={value=>{setPending(current=>({...current,[f.findingId]:value}));setExportMessage("");}}
        onSave={()=>save(f)}/>)}
    <label style={{display:"block"}}>Общий комментарий врача (не является автоматическим диагнозом)
      <textarea value={synthesis} maxLength={4000} rows={3} style={{display:"block",width:"100%"}}
        placeholder="Укажите ограничения исследования, необходимые дообследования и клинический контекст"
        onChange={e=>{setSynthesis(e.target.value);setExportMessage("");}}/>
    </label>
    {error&&<p role="alert">{error}</p>}
    {exportMessage&&<p role="status">{exportMessage}</p>}
    <button type="button" disabled={dirty} onClick={exportLocal}>
      Скачать структурированный врачебный черновик JSON
    </button>
    <p><small>Экспорт содержит SHA-256 исходного публичного исследования, идентификатор и версию модели, три исходных предложения, исправления и журнал решений. Отсутствие найденной патологии не устанавливается. Статус: исследовательский, без электронной подписи.</small></p>
  </section>;
}
