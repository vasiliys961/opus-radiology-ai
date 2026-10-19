"use client";
import {useEffect,useRef,useState} from "react";
import type {AiProvider} from "../lib/ai-gateway";
import type {DualPublicModelReview} from "../lib/dual-public-detector-review";

type Case={caseId:string;title:string;modelNames:string[];factCount:number;clinicalValidation:false};
export default function DualPublicDetectorReview(){
  const [cases,setCases]=useState<Case[]>([]);
  const [choice,setChoice]=useState("lung-nodule");
  const [provider,setProvider]=useState<AiProvider>("polza");
  const [enabled,setEnabled]=useState(false);
  const [consent,setConsent]=useState(false);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState<DualPublicModelReview|null>(null);
  const active=useRef<AbortController|null>(null);
  useEffect(()=>{
    let live=true;
    void fetch("/api/ai/dual-public-detector-review",{cache:"no-store"}).then(async r=>{
      if(!r.ok)throw Error("Недоступно");
      const v:unknown=await r.json();
      if(!v||typeof v!=="object"||(v as {schema?:unknown}).schema!=="opus-dual-public-detector-index/v1")throw Error();
      const data=v as {cases:Case[];enabled:boolean;patientStudyAccepted:false};
      if(data.patientStudyAccepted!==false||!Array.isArray(data.cases)||data.cases.length!==3)throw Error();
      if(live){setCases(data.cases);setEnabled(data.enabled);}
    }).catch(()=>{if(live)setError("Локальный исследовательский AI-маршрут пока недоступен.");});
    return()=>{live=false;active.current?.abort();};
  },[]);
  const submit=async()=>{
    if(!consent||!enabled||busy)return;
    const ctl=new AbortController();active.current=ctl;
    setBusy(true);setResult(null);setError("");
    try{
      const response=await fetch("/api/ai/dual-public-detector-review",{
        method:"POST",cache:"no-store",signal:ctl.signal,
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({caseId:choice,provider,acknowledgePaidPublicResearch:true}),
      });
      const data:unknown=await response.json();
      if(!response.ok)throw Error((data as {error?:string}).error??"Сервер недоступен");
      const review=data as DualPublicModelReview;
      if(review.schema!=="opus-dual-public-detector-review/v1"||
         review.patientDataTransmitted!==false||review.originalCTImagesTransmitted!==false||
         review.newModelInferencePerformed!==false||review.physicianReviewRequired!==true||
         review.source.caseId!==choice||review.provider!==provider||
         review.reviews.length!==2||review.reviews[0].reviewer!=="gemini"||
         review.reviews[1].reviewer!=="opus"||
         review.clinicalStatus!=="unverified_research_draft")throw Error("Неподтверждённый ответ моделей");
      setResult(review);
    }catch(e){setError(ctl.signal.aborted?"Проверка прервана; уже начатые вызовы могут быть оплачены.":
      e instanceof Error?e.message:"Ошибка облачной проверки");}
    finally{setBusy(false);active.current=null;}
  };
  return <section className="cs-geometry" aria-label="Gemini и Opus анализ настоящих результатов CPU-детекторов"
    style={{marginTop:20,padding:16}}>
    <h2>Gemini + Opus · независимая оценка детекторов</h2>
    <p>Подключены <strong>уже выполненные предобученные CPU-детекторы</strong> на настоящих публичных КТ:
      MONAI RetinaNet (лёгочные узлы), модели кровоизлияний и TotalSegmentator (выпот).
      Обе LLM независимо получают только зафиксированные числовые факты и ограничения.
      Новые снимки, DICOM, персональные данные и свободный текст не принимаются.</p>
    <p role="status">Это работающий исследовательский мост, <strong>не анализ текущего пациента</strong>.
      Для будущих обезличенных пациентских кадров нужен отдельный серверный допуск.</p>
    {cases.length>0&&<>
      <div style={{display:"flex",flexWrap:"wrap",gap:12}}>
        <label>Публичное исследование <select disabled={busy} value={choice}
          onChange={e=>{setChoice(e.target.value);setResult(null);setConsent(false);}}>
          {cases.map(c=><option key={c.caseId} value={c.caseId}>{c.title}</option>)}
        </select></label>
        <label>AI-шлюз <select disabled={busy} value={provider} onChange={e=>{
          setProvider(e.target.value as AiProvider);setResult(null);setConsent(false);}}>
          <option value="polza">Polza</option><option value="openrouter">OpenRouter</option>
        </select></label>
      </div>
      <p>Выбранный случай: {cases.find(c=>c.caseId===choice)?.factCount} проверяемых исходных фактов,
        без передачи исходной КТ.</p>
      <label><input type="checkbox" disabled={busy||!enabled} checked={consent}
        onChange={e=>setConsent(e.target.checked)}/>
        Подтверждаю платные два запроса Gemini и Opus только по данным публичного исследования.
      </label>
      <div className="ora-evidence-actions">
        <button type="button" disabled={busy||!consent||!enabled} onClick={()=>void submit()}>
          {busy?"Независимая оценка двух моделей…":"Сравнить Gemini и Opus"}
        </button>
        {busy&&<button type="button" onClick={()=>active.current?.abort()}>Отменить</button>}
      </div>
    </>}
    {!enabled&&<p>По умолчанию отправка отключена. Для разрешённого публичного исследования
      администратор на localhost может установить <code>RADIOLOGY_ENABLE_DUAL_PUBLIC_DETECTOR_LLM=1</code> и ключ выбранного шлюза.</p>}
    {error&&<p role="alert">{error}</p>}
    {result&&<div aria-live="polite">
      <p><strong>Результат: два независимых непроверенных LLM-черновика.</strong>
        Согласие моделей не доказывает заболевание, отсутствие упоминания не исключает патологию.</p>
      <div style={{display:"grid",gap:12}}>
        {result.reviews.map(r=><article key={r.reviewer}
          style={{border:"1px solid #8c9b95",borderRadius:10,padding:12}}>
          <h3>{r.reviewer==="gemini"?"Gemini":"Opus"} · {r.model}</h3>
          <p>{r.review.summary}</p>
          <strong>Приоритет проверки исходных фактов</strong>
          <ul>{r.review.rankedFacts.map(f=><li key={f.factId}>
            <code>{f.factId}</code> · {f.priority} — {f.reason}</li>)}</ul>
          <strong>Вопросы врачу</strong>
          <ul>{r.review.unresolvedQuestions.map((q,i)=><li key={i}>{q}</li>)}</ul>
        </article>)}
      </div>
      <h3>Расхождения оценки</h3>
      {result.priorityConflicts.length===0?<p>Разные приоритеты для общих отмеченных фактов не обнаружены.
        Это не свидетельствует о клиническом согласии.</p>:
        <ul>{result.priorityConflicts.map(x=><li key={x.factId}>{x.factId}: Gemini — {x.geminiPriority},
          Opus — {x.opusPriority}. Требуется врачебная проверка.</li>)}</ul>}
      <p>Не получили приоритета у обеих моделей: {result.notCrossValidated.join(", ")||"нет"}.
        Эти факты не считаются отвергнутыми.</p>
    </div>}
  </section>;
}
