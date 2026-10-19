"use client";

import {useEffect,useRef,useState} from "react";
import type {VisionPrivacyPacket} from "../lib/vision-privacy";
import type {SanitizedModelReview} from "../lib/sanitized-cloud-review";

type Props={
  enabledByLocalChecks:boolean;
  exactReviewedHashes:readonly {imageId:string;sha256:string}[];
  prepareReviewedPacket:()=>VisionPrivacyPacket;
};
type Ready={schema:string;enabled:boolean;productionPatientCloudRelease:false};
export default function DeidentifiedOpenRouterPanel({
  enabledByLocalChecks,exactReviewedHashes,prepareReviewedPacket,
}:Props){
  const [server,setServer]=useState<Ready|null>(null),[token,setToken]=useState("");
  const [clinician,setClinician]=useState(false),[providerRights,setProviderRights]=useState(false);
  const [pixelReview,setPixelReview]=useState(false),[paid,setPaid]=useState(false);
  const [working,setWorking]=useState(false),[error,setError]=useState("");
  const [readinessNote,setReadinessNote]=useState("");
  const [result,setResult]=useState<SanitizedModelReview|null>(null);
  const ctl=useRef<AbortController|null>(null);
  useEffect(()=>{
    let live=true;
    void fetch("/api/ai/deidentified-openrouter-review",{cache:"no-store"}).then(async r=>{
      if(!r.ok)throw Error();
      const x=await r.json() as Ready;
      if(x.schema!=="opus-deidentified-openrouter-pilot-readiness/v1"||
         x.productionPatientCloudRelease!==false)throw Error();
      if(live)setServer(x);
    }).catch(()=>{if(live)setReadinessNote("Локальный облачный пилот недоступен.");});
    return()=>{live=false;ctl.current?.abort();};
  },[]);
  async function send(){
    if(working||!enabledByLocalChecks||!server?.enabled||token.length<24||
       !clinician||!providerRights||!pixelReview||!paid)return;
    setError("");setResult(null);setWorking(true);
    const controller=new AbortController();ctl.current=controller;
    try{
      const packet=prepareReviewedPacket(); // local exact copy + signed action journal check
      if(packet.frames.some((f,i)=>f.frameId!==exactReviewedHashes[i]?.imageId||
         f.sha256!==exactReviewedHashes[i]?.sha256))
        throw Error("Проверенная копия изменилась: повторите проверку.");
      const response=await fetch("/api/ai/deidentified-openrouter-review",{
        method:"POST",cache:"no-store",signal:controller.signal,
        headers:{"Content-Type":"application/json","X-Opus-Local-Operator-Token":token},
        body:JSON.stringify({packet,acknowledgeClinicianLawfulDisclosure:true,
          acknowledgeProviderHealthDataTerms:true,acknowledgePixelIdentityReviewed:true,
          acknowledgeTwoPaidCalls:true}),
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
      setResult(doc);
      setToken("");
    }catch(e){
      setError(controller.signal.aborted?
        "Запрос отменён. Уже начатые обращения могут быть оплачены.":
        e instanceof Error?e.message:"Ошибка анализа проверенных срезов");
    }finally{setWorking(false);ctl.current=null;}
  }
  return <section className="ora-evidence-draft" aria-label="Отправка проверенных обезличенных CT/MR кадров в OpenRouter">
    <h4>OpenRouter · Gemini + Opus на проверенных КТ/МРТ</h4>
    <p>Браузер оставляет исходные DICOM локально. Отправляются только точные
      PNG-копии, прошедшие локальные OCR, закрашивание идентифицирующих надписей
      и два ручных просмотра. Модели получат лишь выборку до четырёх кадров,
      без UID, имён файлов или истории пациента.</p>
    <p role="status"><strong>Режим исследования, не клиническая система.</strong> Даже
      обезличенные изображения остаются медицинскими данными; удаление метаданных
      и OCR не гарантируют анонимность. Ключ OpenRouter остаётся на сервере.</p>
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
      {result.results.map(r=><article key={r.reviewer}
        style={{border:"1px solid #8c9b95",padding:12,borderRadius:8,marginTop:8}}>
        <h4>{r.reviewer==="gemini"?"Gemini Vision":"Opus Vision"} — {r.model}</h4>
        <p>Изучено кадров: {r.review.reviewedImageIds.join(", ")}</p>
        {r.review.observations.length?<ul>{r.review.observations.map(o=><li key={o.id}>
          <strong>{o.imageId} · {o.anatomy}:</strong> {o.sign}
          <small> · Ограничение: {o.uncertainty}</small></li>)}</ul>:
          <p>Наблюдений нет; это не исключает патологию.</p>}
        <ul>{r.review.limitations.map((t,i)=><li key={i}>{t}</li>)}</ul>
      </article>)}
      <p>Разные выводы двух моделей не усредняются. Исходные фреймы и
        привязка к DICOM не покидают браузер. Проверка врачом обязательна.</p>
    </div>}
  </section>;
}
