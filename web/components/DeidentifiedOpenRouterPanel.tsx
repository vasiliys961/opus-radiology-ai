"use client";

import {useEffect,useRef,useState} from "react";
import type {VisionPrivacyPacket} from "../lib/vision-privacy";
import type {SanitizedModelReview} from "../lib/sanitized-cloud-review";
import {buildLocalDualReviewDraft,findingReviewKey,type LocalObservationAssessment} from "../lib/local-dual-vision-physician-draft";
import type {LocalLungFacts} from "../lib/local-lung-review";
import type {LocalSameSeriesLaa950} from "../lib/same-series-laa950-review";
import {validateSanitizedDetectorBundle,type SanitizedDetectorBundle} from "../lib/detector-consilium-evidence";
import {bindLocalSanitizedReview,sourceFileForObservation,perFrameModelCoverage} from "../lib/local-cloud-source-navigation";

type Props={
  enabledByLocalChecks:boolean;
  exactReviewedHashes:readonly {imageId:string;sha256:string}[];
  prepareReviewedPacket:()=>VisionPrivacyPacket;
  specialistFacts?:LocalLungFacts|null;
  originalDetectorEvidence?:SanitizedDetectorBundle|null;
  localLaa950?:LocalSameSeriesLaa950|null;
  specialistLocalBinding?:string;
  originalLocalFileIds:readonly string[];
  onOpenOriginalSlice:(localFileId:string)=>void;
};
type Ready={schema:string;enabled:boolean;productionPatientCloudRelease:false};
export default function DeidentifiedOpenRouterPanel({
  enabledByLocalChecks,exactReviewedHashes,prepareReviewedPacket,
  originalLocalFileIds,onOpenOriginalSlice,specialistFacts,specialistLocalBinding,localLaa950,originalDetectorEvidence=null,
}:Props){
  const [server,setServer]=useState<Ready|null>(null),[token,setToken]=useState("");
  const [clinician,setClinician]=useState(false),[providerRights,setProviderRights]=useState(false);
  const [pixelReview,setPixelReview]=useState(false),[paid,setPaid]=useState(false);
  const [working,setWorking]=useState(false),[error,setError]=useState("");
  const [readinessNote,setReadinessNote]=useState("");
  const [includeSpecialist,setIncludeSpecialist]=useState(false);
  const [includeDetectors,setIncludeDetectors]=useState(false);
  const [result,setResult]=useState<SanitizedModelReview|null>(null);
  const [decisions,setDecisions]=useState<Record<string,LocalObservationAssessment>>({});
  const [clinicalSynthesis,setClinicalSynthesis]=useState("");
  const [draftError,setDraftError]=useState("");
  const ctl=useRef<AbortController|null>(null);
  // Never probe even localhost without a clinician/operator click.
  // This is essential for offline DICOM review and fail-closed browser tests.
  useEffect(()=>()=>{ctl.current?.abort();},[]);
  useEffect(()=>{setResult(null);setIncludeSpecialist(false);setDecisions({});setClinicalSynthesis("");},[specialistLocalBinding]);
  useEffect(()=>{setResult(null);setIncludeDetectors(false);setDecisions({});setClinicalSynthesis("");},[originalDetectorEvidence]);
  async function checkReadiness(){
    if(working)return;
    setReadinessNote("");setError("");setServer(null);
    try{
      const r=await fetch("/api/ai/deidentified-openrouter-review",{cache:"no-store"});
      if(!r.ok)throw Error();
      const x=await r.json() as Ready;
      if(x.schema!=="opus-deidentified-openrouter-pilot-readiness/v1"||
         x.productionPatientCloudRelease!==false)throw Error();
      setServer(x);
      if(!x.enabled)setReadinessNote("Локальный пилот не включён администратором.");
    }catch{setReadinessNote("Локальный облачный пилот недоступен.");}
  }
  async function send(){
    if(working||!enabledByLocalChecks||!server?.enabled||token.length<24||
       !clinician||!providerRights||!pixelReview||!paid)return;
    setError("");setResult(null);setDecisions({});setClinicalSynthesis("");setDraftError("");setWorking(true);
    const controller=new AbortController();ctl.current=controller;
    try{
      const packet=prepareReviewedPacket(); // local exact copy + signed action journal check
      if(packet.frames.some((f,i)=>f.frameId!==exactReviewedHashes[i]?.imageId||
         f.sha256!==exactReviewedHashes[i]?.sha256))
        throw Error("Проверенная копия изменилась: повторите проверку.");
      const sentSpecialist=includeSpecialist&&specialistFacts?specialistFacts:null;
      const sentDetectors=includeDetectors&&originalDetectorEvidence?
        originalDetectorEvidence:null;
      if(sentDetectors&&(!validateSanitizedDetectorBundle(sentDetectors)||
          !sentDetectors.facts.some(f=>f.status==="completed")||
          sentDetectors.modality!==packet.frames[0]?.modality))
        throw Error("Пакет патологических детекторов не соответствует проверенным кадрам.");
      const response=await fetch("/api/ai/deidentified-openrouter-review",{
        method:"POST",cache:"no-store",signal:controller.signal,
        headers:{"Content-Type":"application/json","X-Opus-Local-Operator-Token":token},
        body:JSON.stringify({packet,acknowledgeClinicianLawfulDisclosure:true,
          acknowledgeProviderHealthDataTerms:true,acknowledgePixelIdentityReviewed:true,
          acknowledgeTwoPaidCalls:true,
          ...(sentSpecialist?{specialistFacts:sentSpecialist}:{}),
          ...(sentDetectors?{detectorEvidence:sentDetectors}:{})}),
      });
      const body:unknown=await response.json();
      if(!response.ok)throw Error((body as {error?:string}).error??"OpenRouter недоступен");
      const doc=body as SanitizedModelReview;
      if(doc.schema!=="opus-sanitized-cloud-pilot/v1"||doc.results.length!==2||
         doc.results[0].reviewer!=="gemini"||doc.results[1].reviewer!=="opus"||
         doc.originalDicomSent!==false||doc.sourceDicomIdentifiersSent!==false||
         doc.researchOnly!==true||doc.deidentificationIndependentlyCertified!==false||
         doc.sourceFrames.length!==exactReviewedHashes.length||
         doc.sourceFrames.some((f,i)=>f.imageId!==exactReviewedHashes[i].imageId||
           f.reviewedPixelSha256!==exactReviewedHashes[i].sha256))
        throw Error("Неверный паспорт облачного ответа.");
      if(sentSpecialist &&
         (!doc.specialistEvidence||
          doc.specialistEvidence.model!=="lungmask-R231"||
          doc.specialistEvidence.frameCount!==sentSpecialist.frameCount||
          doc.specialistEvidence.rightLungMaskMl!==sentSpecialist.rightLungMaskMl||
          doc.specialistEvidence.leftLungMaskMl!==sentSpecialist.leftLungMaskMl||
          doc.specialistEvidence.clinicalProvenanceServerVerified!==false||
          doc.specialistEvidence.findingOfPathologyEstablished!==false))
        throw Error("Источник численных данных R231 не подтверждён.");
      if(!sentSpecialist&&doc.specialistEvidence)
        throw Error("Непредусмотренные данные модели в ответе.");
      if(sentDetectors){
        if(!doc.detectorEvidence||
           JSON.stringify(doc.detectorEvidence)!==JSON.stringify(sentDetectors))
          throw Error("Поставщик AI не вернул тот же обезличенный пакет детекторов.");
      }else if(doc.detectorEvidence)
        throw Error("Модель получила незапрошенные сведения детекторов.");
      // An unbound or changed source makes ALL clinical navigation unavailable.
      bindLocalSanitizedReview(doc,exactReviewedHashes.map(f=>({imageId:f.imageId,reviewedPixelSha256:f.sha256})),originalLocalFileIds);
      setResult(doc);
      setToken("");
    }catch(e){
      setError(controller.signal.aborted?
        "Запрос отменён. Уже начатые обращения могут быть оплачены.":
        e instanceof Error?e.message:"Ошибка анализа проверенных срезов");
    }finally{setWorking(false);ctl.current=null;}
  }
  const downloadLocalReview=()=>{
    if(!result)return;
    try{
      const doc=buildLocalDualReviewDraft(result,
        exactReviewedHashes.map(f=>({imageId:f.imageId,reviewedPixelSha256:f.sha256})),
        originalLocalFileIds,decisions,clinicalSynthesis);
      const blob=new Blob([JSON.stringify(doc,null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;
      a.download="opus-local-gemini-opus-physician-review.json";
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      setDraftError("");
    }catch{setDraftError("Сверка потеряла исходную серию или содержит неподтверждённое наблюдение. Экспорт запрещён.");}
  };
  return <section className="ora-evidence-draft" aria-label="Отправка проверенных обезличенных CT/MR кадров в OpenRouter">
    <h4>OpenRouter · Gemini + Opus на проверенных КТ/МРТ</h4>
    <p>Браузер оставляет исходные DICOM локально. Отправляются только точные
      PNG-копии, прошедшие локальные OCR, закрашивание идентифицирующих надписей
      и два ручных просмотра. Модели получат лишь выборку до четырёх кадров,
      без UID, имён файлов или истории пациента.</p>
    <p role="status"><strong>Режим исследования, не клиническая система.</strong> Даже
      обезличенные изображения остаются медицинскими данными; удаление метаданных
      и OCR не гарантируют анонимность. Ключ OpenRouter остаётся на сервере.</p>
    <div className="ora-evidence-actions">
      <button type="button" disabled={working} onClick={()=>void checkReadiness()}>
        Проверить локальное разрешение OpenRouter
      </button>
    </div>
    {!server?.enabled&&<p>Серверный доступ по умолчанию выключен. Нужны
      <code> RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT=1</code>,
      <code> RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED=1</code>,
      <code> OPENROUTER_API_KEY</code> и
      <code> RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN</code> (24+ символов).
      Включать только после проверки прав передачи медицинских данных провайдеру.</p>}
    {!enabledByLocalChecks&&<p role="status">Прежде чем отправлять, проверьте
      OCR на каждом кадре и подтвердите надписи и узнаваемые признаки на
      каждой точной PNG-копии. Любое изменение изображения сбрасывает допуск.</p>}
    <label>Локальный пароль оператора <input type="password" value={token}
      autoComplete="off" maxLength={512} disabled={working}
      onChange={e=>setToken(e.target.value)} placeholder="Только локальный сервер"/></label>
    <label><input type="checkbox" disabled={working} checked={clinician}
      onChange={e=>setClinician(e.target.checked)}/>
      Я уполномочен работать с этим исследованием и подтверждаю законное
      основание для передачи обезличенных медицинских изображений.</label>
    <label><input type="checkbox" disabled={working} checked={providerRights}
      onChange={e=>setProviderRights(e.target.checked)}/>
      Подтверждаю, что условия OpenRouter и выбранных моделей разрешают эту
      обработку медицинских изображений и необходимую передачу данных.</label>
    <label><input type="checkbox" disabled={working} checked={pixelReview}
      onChange={e=>setPixelReview(e.target.checked)}/>
      Проверил все исходящие изображения: нет имён, дат рождения, ID,
      надписей учреждения, лиц или других узнаваемых признаков.</label>
    {specialistFacts&&<label><input type="checkbox" disabled={working}
      checked={includeSpecialist} onChange={e=>{setIncludeSpecialist(e.target.checked);setResult(null);}}/>
      Дополнительно передать обеим LLM только измерения из локального R231
      той же КТ: правая маска {specialistFacts.rightLungMaskMl.toFixed(1)} мл,
      левая {specialistFacts.leftLungMaskMl.toFixed(1)} мл, {specialistFacts.frameCount} срезов.
      Маска, UID и путь исходных DICOM не передаются. Модель R231 размечает
      лёгкие, но не детектирует патологию.</label>}
    {originalDetectorEvidence&&validateSanitizedDetectorBundle(originalDetectorEvidence)&&
      <label><input type="checkbox" disabled={working}
        checked={includeDetectors} onChange={e=>{
          setIncludeDetectors(e.target.checked);setResult(null);
        }}/>
        Дополнительно передать Gemini Vision и Opus ТОЛЬКО числовые модельные
        находки текущей DICOM-серии: завершено {
          originalDetectorEvidence.facts.filter(f=>f.status==="completed").length
        } из {originalDetectorEvidence.facts.length} задач.
        Исходные UID, SHA, координаты и сами маски не передаются.
      </label>}
    <label><input type="checkbox" disabled={working} checked={paid}
      onChange={e=>setPaid(e.target.checked)}/>
      Разрешаю два платных вызова: Gemini 3.8 Flash и Claude Opus 5.5
      через OpenRouter без автоматического повтора.</label>
    <div className="ora-evidence-actions">
      <button type="button" disabled={working||!enabledByLocalChecks||
        !server?.enabled||token.length<24||!clinician||!providerRights||!pixelReview||!paid}
        onClick={()=>void send()}>{working?"Два AI анализируют выборку…":
        "Отправить проверенные кадры Gemini + Opus"}</button>
      {working&&<button type="button" onClick={()=>ctl.current?.abort()}>Отменить</button>}
    </div>
    {readinessNote&&<p role="status">{readinessNote}</p>}
    {error&&<p role="alert">{error}</p>}
    {result&&<div aria-live="polite">
      <p><strong>Ответ моделей получен.</strong> Это черновые визуальные
        наблюдения по отдельным срезам, не полноценный анализ исследования
        и не диагноз. Врач сверяет их с исходным DICOM локально.</p>
      <h4>Покадровое сопоставление · без голосования моделей</h4>
      <p>Числа ниже — количество текстовых наблюдений, не вероятность заболевания
        и не доказательство согласия Gemini и Opus.</p>
      <ul>{perFrameModelCoverage(result).map(row=><li key={row.imageId}>
        Кадр {row.imageId}: Gemini — {row.geminiFindings}; Opus — {row.opusFindings}.
        <button type="button" onClick={()=>{
          try{
            const id=sourceFileForObservation(result,
              exactReviewedHashes.map(f=>({imageId:f.imageId,reviewedPixelSha256:f.sha256})),
              originalLocalFileIds,row.imageId);
            onOpenOriginalSlice(id);setError("");
          }catch{setError("Срез больше не совпадает с проверенным исходным DICOM. Повторите локальную привязку.");}
        }}>Открыть исходный DICOM-срез</button>
      </li>)}</ul>
      {result.detectorEvidence&&<section aria-label="Числовые находки реальных моделей той же КТ/МРТ">
        <h4>Реальные детекторы · тот же исходный DICOM</h4>
        <p>Gemini Vision и Claude Opus получили только ограниченные числовые сведения.
        Модельное совпадение не доказывает клиническую точность.</p>
        {result.detectorEvidence.facts.map(f=><p key={f.task}>
          {f.task}: {f.status==="completed"?
            "модельных кандидатов "+f.candidateCount:"не исследовано"}
        </p>)}
      </section>}
      {result.specialistEvidence&&<section aria-label="Объединённые локальные данные R231 и Gemini Opus">
        <h4>Локальный CPU-детектор · Lungmask R231</h4>
        <p>Объёмы сегментации той же выбранной КТ:
          справа {result.specialistEvidence.rightLungMaskMl.toFixed(1)} мл,
          слева {result.specialistEvidence.leftLungMaskMl.toFixed(1)} мл,
          {result.specialistEvidence.frameCount} срезов.</p>
        <p>Маски — анатомические, не очаги болезни. Подлинность происхождения
          чисел дополнительно не проверялась сервером OpenRouter;
          сопоставление с исходной КТ сделано локально.</p>
      </section>}
      {localLaa950&&<section aria-label="Локальная HU-денситометрия того же CT без облака">
        <h4>LAA−950 · отдельное локальное измерение текущей КТ</h4>
        <p>Внутри обработанного фрагмента маски R231:
          всего {localLaa950.lowAttenuationPctOfSampledMask.toFixed(2)}%,
          справа {localLaa950.rightLungPct.toFixed(2)}%,
          слева {localLaa950.leftLungPct.toFixed(2)}% вокселей ≤−950 HU.</p>
        <p>Этот показатель вычислен только на CPU и
          <strong> не направлялся Gemini или Opus</strong>.
          Это не независимое подтверждение LLM и не диагноз эмфиземы или ХОБЛ.
          Точная калибровка декодера и полнота лёгких ещё не доказаны.</p>
      </section>}
      {result.results.map(r=><article key={r.reviewer}
        style={{border:"1px solid #8c9b95",padding:12,borderRadius:8,marginTop:8}}>
        <h4>{r.reviewer==="gemini"?"Gemini Vision":"Opus Vision"} — {r.model}</h4>
        <p>Изучено кадров: {r.review.reviewedImageIds.join(", ")}</p>
        {r.review.observations.length?<ul>{r.review.observations.map(o=><li key={o.id}>
          <strong>{o.imageId} · {o.anatomy}:</strong> {o.sign}
          <small> · Ограничение: {o.uncertainty}</small>
          <div className="ora-evidence-actions">
            {(["needs_original_source_recheck","rejected_by_local_reviewer"] as const).map(choice=>
              <button type="button" key={choice}
                aria-pressed={decisions[findingReviewKey(r.reviewer,o.imageId,o.id)]?.decision===choice}
                onClick={()=>{const key=findingReviewKey(r.reviewer,o.imageId,o.id);
                  setDecisions(prev=>({...prev,[key]:{decision:choice,note:prev[key]?.note??""}}));}}>
                {choice==="needs_original_source_recheck"?"На перепроверку":"Отклонить локально"}
              </button>)}
          </div>
          <label>Локальная заметка врача · {o.imageId}
            <textarea rows={2} maxLength={500}
              value={decisions[findingReviewKey(r.reviewer,o.imageId,o.id)]?.note??""}
              onChange={e=>{const key=findingReviewKey(r.reviewer,o.imageId,o.id);
                setDecisions(prev=>({...prev,[key]:{
                  decision:prev[key]?.decision??"unreviewed",note:e.target.value,
                }}));}}/>
          </label>
          <button type="button" onClick={()=>{
            try{
              const id=sourceFileForObservation(result,
                exactReviewedHashes.map(f=>({imageId:f.imageId,reviewedPixelSha256:f.sha256})),
                originalLocalFileIds,o.imageId);
              onOpenOriginalSlice(id);setError("");
            }catch{setError("Источник наблюдения изменился или не найден. Переход заблокирован.");}
          }}>Показать исходный срез</button>
        </li>)}</ul>:
          <p>Наблюдений нет; это не исключает патологию.</p>}
        <ul>{r.review.limitations.map((t,i)=><li key={i}>{t}</li>)}</ul>
      </article>)}
      <section className="ora-reviewer-note" aria-label="Локальная врачебная сверка Gemini Opus и R231">
        <h4>Врачебная сверка наблюдений и детектора · локально</h4>
        <p>Отметки относятся только к наблюдениям отдельных срезов.
          Выводы Gemini и Opus не голосуют за диагноз.
          Врачебные записи остаются в браузере и могут содержать чувствительные данные.</p>
        <label>Рабочий синтез врача (необязательно)
          <textarea rows={3} maxLength={4000} value={clinicalSynthesis}
            onChange={e=>setClinicalSynthesis(e.target.value)}/>
        </label>
        <button type="button" onClick={downloadLocalReview}>
          Скачать локальный неподписанный протокол сверки JSON
        </button>
        {draftError&&<p role="alert">{draftError}</p>}
        <small>Протокол не содержит исходные UID, имена файлов, пиксели или DICOM,
          но текст наблюдений и врачебных заметок может быть медицинской тайной.
          Храните его локально; данные не направляются LLM повторно.</small>
      </section>
      <p>Разные выводы двух моделей не усредняются. Исходные фреймы и
        привязка к DICOM не покидают браузер. Проверка врачом обязательна.</p>
    </div>}
  </section>;
}
