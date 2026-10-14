"use client";
import {useState} from "react";
import type {IchResearchReport} from "../lib/ich-research";
import type {IchReferenceComparison} from "../lib/ich-reference-comparison";
import {buildSmallMissLocalReview,type SmallMissDecision} from "../lib/ich-small-miss-review";
import {
 parseIchComponentEvidence,type IchComponentEvidence,type IchMaskFragment
} from "../lib/ich-component-evidence";

function FragmentList({heading,fragments,onGoToSlice}:{
 heading:string;fragments:IchMaskFragment[];
 onGoToSlice:(k:number)=>void;
}){
 return <div style={{marginTop:12,overflowX:"auto"}}>
  <h5>{heading}</h5>
  {!fragments.length?<p>Среди показанных крупных компонент таких областей нет.</p>:
   <table style={{width:"100%",fontSize:13,borderCollapse:"collapse"}}>
    <thead><tr><th>Компонента</th><th>Объём</th>
      <th>Границы [i, j, k]</th><th>Не совпало</th><th>Перекрытие</th><th>Исходная КТ</th></tr></thead>
    <tbody>{fragments.slice(0,24).map(f=>{
      const k=f.reviewSliceIndexK??Math.floor((f.boundsVoxelMin[2]+f.boundsVoxelMax[2])/2);
      const missing=f.voxelCount-f.overlapVoxels;
      return <tr key={f.componentIndex}>
        <td>{f.componentIndex+1}</td>
        <td>{f.volumeMl.toFixed(3)} мл</td>
        <td>{f.boundsVoxelMin.join(", ")} — {f.boundsVoxelMax.join(", ")}</td>
        <td><strong>{missing}</strong> вокс.
          {f.reviewSliceUnmatchedVoxels!==undefined?
            <small> · на выбранном k: {f.reviewSliceUnmatchedVoxels}</small>:null}</td>
        <td>{f.overlapVoxels} вокс.</td>
        <td><button type="button"
          aria-label={`Открыть исходный КТ-срез k ${k+1} для компоненты ${f.componentIndex+1}`}
          onClick={()=>onGoToSlice(k)}>КТ · k {k+1}</button></td>
      </tr>;
    })}</tbody>
   </table>}
 </div>;
}
export default function IchComponentEvidencePanel({comparison,model,onGoToSlice}:{
 comparison:IchReferenceComparison;model:IchResearchReport;
 onGoToSlice:(nativeK:number)=>void;
}){
 const [report,setReport]=useState<IchComponentEvidence|null>(null);
 const [error,setError]=useState("");
 const [smallReviews,setSmallReviews]=useState<Record<number,SmallMissDecision>>({});
 function saveSmallReviews(){
   if(!report)return;
   let url:string|null=null;
   try{
     const document=buildSmallMissLocalReview(report,smallReviews);
     url=URL.createObjectURL(new Blob([JSON.stringify(document,null,2)],
       {type:"application/json"}));
     const a=document.createElement("a");
     a.href=url;a.download="opus-ich-small-miss-local-physician-review.json";
     document.body.appendChild(a);a.click();a.remove();
     const usedUrl=url;
     setTimeout(()=>URL.revokeObjectURL(usedUrl),1000);
     url=null;setError("");
   }catch(e){setError(e instanceof Error?e.message:"Экспорт пометок не выполнен.");}
   finally{if(url)URL.revokeObjectURL(url);}
 }
 async function read(file:File){
   setError("");setReport(null);setSmallReviews({});
   try{
     if(!file.size||file.size>2*1024*1024)throw Error("Некорректный размер файла.");
     setReport(parseIchComponentEvidence(await file.text(),comparison,model));
   }catch(e){setError(e instanceof Error?e.message:"3D-паспорт не принят.");}
 }
 const c=report?.componentEvidence;
 const missed=(c?.largestExpertFragments??[])
   .filter(x=>x.voxelCount>x.overlapVoxels)
   .sort((a,b)=>(b.voxelCount-b.overlapVoxels)-(a.voxelCount-a.overlapVoxels));
 const extra=(c?.largestPredictedFragments??[])
   .filter(x=>x.voxelCount>x.overlapVoxels)
   .sort((a,b)=>(b.voxelCount-b.overlapVoxels)-(a.voxelCount-a.overlapVoxels));
 const ambiguous=c?.largestPredictedFragments.filter(x=>x.ambiguousMultiComponentContact)??[];
 return <section aria-label="Экспертная проверка 3D-компонент кровоизлияния"
  style={{border:"1px solid #9ab6a8",borderRadius:8,padding:12,margin:"14px 0"}}>
  <h5>3D · какие фрагменты разметки пропущены моделью</h5>
  <p>Импорт отчёта <code>ich-expert-component-contact.py</code>. Для отображения
    должны уже совпасть SHA-256 исходной КТ, SAMIHS-маски и экспертной маски.
    Импортируемые числа проверяются с 3D Dice и контрольными объёмами.</p>
  <label>Отчёт контакта 3D-компонент
   <input type="file" accept=".json,application/json" onChange={e=>{
    const file=e.target.files?.[0];e.currentTarget.value="";
    if(file)void read(file);
   }}/>
  </label>
  {error&&<p role="alert">{error}</p>}
  {c&&<>
    <p role="status">Фрагменты экспертной маски: {c.expertFragmentsTotal};
      без пересечения с SAMIHS: <strong>{c.expertFragmentsWithZeroOverlap}</strong>.
      Кандидаты модели без пересечения с эталоном:
      <strong> {c.predictedFragmentsWithZeroOverlap}</strong>.
    </p>
    <p>Один фрагмент модели перекрывает несколько экспертных компонент:
      <strong> {c.predictedFragmentsContactingMultipleExpertFragments}</strong>.
      Один экспертный фрагмент касается нескольких предсказанных:
      <strong> {c.expertFragmentsContactingMultiplePredictions}</strong>.</p>
    {c.expertFragmentVolumeStrata&&<div style={{overflowX:"auto",margin:"12px 0"}}>
      <h5>Пропуски по физическому объёму экспертных фрагментов</h5>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr><th>Размер фрагмента</th><th>Всего</th>
          <th>Без пересечения</th><th>Пропущенный объём</th>
          <th>Непокрытые воксели</th></tr></thead>
        <tbody>{c.expertFragmentVolumeStrata.map((b,i)=><tr key={i}>
          <td>{b.maxVolumeMl===null?"≥ 1 мл":
            i===0?"менее 0,1 мл":"0,1–<1 мл"}</td>
          <td>{b.expertFragments}</td>
          <td><strong>{b.withZeroOverlap}</strong></td>
          <td>{b.missedVolumeMl.toFixed(3)} мл</td>
          <td>{b.missedVoxels}</td>
        </tr>)}</tbody>
      </table>
      <p><small>Учтены все компоненты экспертной бинарной разметки, включая
        не показанные в таблицах. Частично непокрытые объёмы включены.
        Это не чувствительность к отдельным очагам: один воксель совпадения
        классифицирует фрагмент как имеющий пересечение.</small></p>
    </div>}
    <p><small>В суммах учтены все фрагменты; таблицы содержат только
      {c.reportedLargestPerMaskLimit} самых крупных на маску.
      Показаны и частичные ошибки: даже один воксель перекрытия не скрывает
      оставшуюся непокрытую область. В новых отчётах кнопка ведёт к k-срезу
      с максимальным количеством несовпадающих вокселей данного фрагмента,
      в старых — к середине его границ. Это нативный индекс NIfTI, не
      клинически подтверждённая координата.</small></p>
    {c.submilliliterReviewCandidates&&<>
      <p><strong>Приоритет локальной проверки малых пропусков:</strong>
        {" "}{c.submilliliterReviewCandidatesTotal} экспертных фрагментов менее 1 мл
        с непокрытыми вокселями. В первую очередь показаны полностью
        пропущенные фрагменты, затем частично пропущенные с наибольшим FN.
        Кнопки открывают нативный срез с максимальным FN.</p>
      <FragmentList heading="Малые экспертные фрагменты для прицельной проверки по КТ"
        fragments={c.submilliliterReviewCandidates} onGoToSlice={onGoToSlice}/>
      <details style={{margin:"12px 0"}}>
        <summary>Локальная врачебная оценка небольших пропусков · без цифровой подписи</summary>
        {c.submilliliterReviewCandidates.map(f=>{
          const review=smallReviews[f.componentIndex];
          return <fieldset key={f.componentIndex} style={{margin:"10px 0",padding:10}}>
            <legend>Экспертный фрагмент {f.componentIndex+1} ·
              {" "}{f.volumeMl.toFixed(3)} мл · FN {f.voxelCount-f.overlapVoxels}</legend>
            <label>Сопоставление с экспертной разметкой
              <select value={review?.status??""} onChange={e=>{
                const status=e.target.value as SmallMissDecision["status"];
                setSmallReviews(prev=>{
                  if(!status){const next={...prev};delete next[f.componentIndex];return next;}
                  return {...prev,[f.componentIndex]:{
                    status,note:prev[f.componentIndex]?.note??""
                  }};
                });
              }}>
                <option value="">Не оценён</option>
                <option value="recheck">Нужна повторная проверка</option>
                <option value="supports_expert_mark">Согласен с экспертной разметкой</option>
                <option value="disputes_expert_mark">Экспертную разметку оспариваю</option>
              </select>
            </label>
            <label style={{display:"block"}}>Пояснение (без персональных данных)
              <textarea rows={2} maxLength={1000} style={{width:"100%",display:"block"}}
                value={review?.note??""} onChange={e=>setSmallReviews(prev=>{
                  const entry=prev[f.componentIndex];
                  return entry?{...prev,[f.componentIndex]:{...entry,note:e.target.value}}:prev;
                })}/>
            </label>
            <button type="button" onClick={()=>onGoToSlice(
              f.reviewSliceIndexK??Math.floor((f.boundsVoxelMin[2]+f.boundsVoxelMax[2])/2)
            )}>Открыть источник для проверки</button>
          </fieldset>;
        })}
        <button type="button" disabled={!Object.keys(smallReviews).length}
          onClick={saveSmallReviews}>Скачать локальные врачебные пометки с SHA-256</button>
        <p><small>Экспорт содержит только решения, комментарии, исходный индекс k,
          объём фрагмента и SHA-256 трёх файлов. Это неподписанные локальные
          заметки, а не удостоверенная клиническая валидация.
          Никакие изображения не отправляются наружу.</small></p>
      </details>
    </>}
    <FragmentList heading="Экспертные фрагменты с пропущенными вокселями (FN)"
      fragments={missed} onGoToSlice={onGoToSlice}/>
    <FragmentList heading="Кандидаты SAMIHS с лишними вокселями (FP)"
      fragments={extra} onGoToSlice={onGoToSlice}/>
    <FragmentList heading="Неоднозначные объединения предсказанной маски"
      fragments={ambiguous} onGoToSlice={onGoToSlice}/>
    <p role="note"><strong>Не диагноз.</strong> Компоненты связности при толстой КТ
      не обязательно отдельные гематомы. Одно совпадение вокселя не доказывает
      обнаружение очага; не рассчитана клиническая чувствительность или
      специфичность. Нет определения типа кровоизлияния и DICOM SOP-связи.</p>
    <button type="button" onClick={()=>{setReport(null);setSmallReviews({});}}>Закрыть 3D-оценку</button>
  </>}
 </section>;
}
