"use client";

import {useState} from "react";
import {calculateManualIchVolume,type IchDimensions,type ManualIchVolume} from "../lib/ich-volume";

/** Manual CT HEAD quantitative clinical tool; NOT an AI hemorrhage detector. */
export default function HeadHemorrhageVolumePanel({seriesKeys}:{
  seriesKeys:readonly string[];
}){
  const [seriesKey,setSeriesKey]=useState(seriesKeys[0]??"");
  const [dimensions,setDimensions]=useState<Partial<IchDimensions>>({});
  const [result,setResult]=useState<ManualIchVolume|null>(null);
  const [error,setError]=useState("");
  function update(name:keyof IchDimensions,raw:string){
    setDimensions(p=>({...p,[name]:raw===""?undefined:Number(raw)}));
    setResult(null);setError("");
  }
  function calculate(){
    setError("");
    try{
      const {aMm,bMm,cMm}=dimensions;
      if(aMm===undefined||bMm===undefined||cMm===undefined)
        throw Error("Сначала укажите три измеренных размера A, B, C в миллиметрах.");
      setResult(calculateManualIchVolume({aMm,bMm,cMm},seriesKey));
    }catch(e){setResult(null);setError(e instanceof Error?e.message:"Ошибка измерений.");}
  }
  function save(){
    if(!result)return;
    const data=new Blob([JSON.stringify(result,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(data);
    const a=document.createElement("a");
    a.href=url;a.download="opus-ct-head-manual-ich-abc2.json";
    document.body.appendChild(a);a.click();a.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section aria-label="КТ головного мозга · ручная оценка объёма гематомы"
    style={{border:"1px solid #688f81",borderRadius:10,padding:14,marginTop:18}}>
    <h3>КТ головного мозга · внутримозговое кровоизлияние</h3>
    <p><strong>Ручная оценка объёма по ABC/2</strong> — количественный инструмент врача,
      не детектор кровоизлияний. Открытые серии КТ головы не означают,
      что программа обнаружила патологию.</p>
    <label>Исходная серия КТ головы
      <select value={seriesKey} onChange={e=>{setSeriesKey(e.target.value);setResult(null);}}>
        {seriesKeys.map((key,i)=><option key={key} value={key}>КТ головы · серия {i+1}</option>)}
      </select>
    </label>
    <p>Для одиночного приблизительно эллипсоидного внутримозгового кровоизлияния:
      A — наибольший диаметр в аксиальной плоскости, B — перпендикулярный ему
      диаметр на том же срезе, C — краниокаудальная протяжённость очага.
      Все размеры вводятся врачом по исходному исследованию.</p>
    <div style={{display:"flex",flexWrap:"wrap",gap:12}}>
      {([["aMm","A · мм"],["bMm","B · мм"],["cMm","C · мм"]] as const).map(([key,label])=>
        <label key={key} style={{minWidth:115}}>{label}
          <input style={{display:"block",width:110}} type="number" min="0.1" max="300"
            step="0.1" inputMode="decimal" value={dimensions[key]??""}
            onChange={e=>update(key,e.target.value)}/>
        </label>)}
    </div>
    <button type="button" onClick={calculate}>Рассчитать приблизительный объём</button>
    {error&&<p role="alert">{error}</p>}
    {result&&<>
      <p role="status"><strong>Объём ABC/2 ≈ {result.approximateVolumeMl.toFixed(1)} мл</strong>.
        Рассчитан из введённых размеров, не из пикселей и не нейросетью.</p>
      {result.approximateVolumeMl>200&&<p role="alert">
        Большой расчётный объём: перепроверьте размеры, форму очага и применимость ABC/2.
      </p>}
      <button type="button" onClick={save}>Скачать паспорт ручного измерения JSON</button>
    </>}
    <p role="note">Метод не предназначен для субарахноидального, субдурального,
      эпидурального или изолированного внутрижелудочкового кровоизлияния,
      а также не заменяет объёмную сегментацию при сложной форме очага.
      Результат не является автоматическим диагнозом и не отправляется в облако.</p>
  </section>;
}
