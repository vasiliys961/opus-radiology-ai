"use client";
import {useEffect,useRef,useState} from "react";
import {decodeDicomPreview} from "../lib/dicom-lite";
import PlainImageAnalysis,{type AnalysisView} from "./PlainImageAnalysis";

export type CompareItem=AnalysisView&{url?:string};

export default function RadiographCompare({items}:{items:CompareItem[]}){
 const key=items.map(item=>item.id).join("\n");
 const previousIds=useRef("");
 const [left,setLeft]=useState(items[0]?.id??"");
 const [right,setRight]=useState(items[1]?.id??"");
 const [urls,setUrls]=useState<Record<string,string>>({});
 const [error,setError]=useState("");
 useEffect(()=>{
  const seen=new Set(previousIds.current.split("\n").filter(Boolean));
  previousIds.current=key;
  const added=items.filter(item=>!seen.has(item.id));
  setLeft(current=>items.some(item=>item.id===current)?current:(items[0]?.id??""));
  if(added.length===1&&items.length>1){setRight(added[0].id);return;}
  setRight(current=>items.some(item=>item.id===current)?current:(items[1]?.id??items[0]?.id??""));
 },[key]);
 useEffect(()=>{
  const owned:string[]=[];
  let stop=false;
  setError("");
  setUrls({});
  void (async()=>{
   const next:Record<string,string>={};
   for(const item of items){
    if(stop)break;
    if(item.url){next[item.id]=item.url;continue;}
    try{
     const preview=await decodeDicomPreview(item.file,{maxPixels:4096*4096});
     owned.push(preview.url);
     next[item.id]=preview.url;
    }catch{if(!stop)setError("Одну из проекций не удалось показать.");}
   }
   if(stop)owned.forEach(url=>URL.revokeObjectURL(url));
   else setUrls({...next});
  })();
  return()=>{stop=true;owned.forEach(url=>URL.revokeObjectURL(url));};
 },[key]);
 const picked=[left,right].filter((id,index,list)=>!!id&&list.indexOf(id)===index);
 const chosen=picked.map(id=>items.find(item=>item.id===id)).filter((item):item is CompareItem=>!!item);
 const leftItem=items.find(item=>item.id===left);
 const rightItem=items.find(item=>item.id===right);
 return <section className="cs-compare" aria-label="Сравнение проекций">
  <h3>Сравнение проекций</h3>
  <p>Следующую рентгенограмму можно открыть отдельно: она добавится справа. Разбор уходит в Gemini и Opus по выбранной паре.</p>
  <div className="cs-compare-controls">
   <label>Слева
    <select value={left} onChange={event=>setLeft(event.target.value)}>
     {items.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
   </label>
   <label>Справа
    <select value={right} onChange={event=>setRight(event.target.value)}>
     {items.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
   </label>
  </div>
  {left===right&&<p role="status">Выбрана одна проекция.</p>}
  {error&&<p role="alert">{error}</p>}
  <div className="cs-compare-pair">
   <figure>
    {leftItem&&urls[leftItem.id]?<img src={urls[leftItem.id]} alt={leftItem.label}/>:<p>Готовим левую проекцию…</p>}
    <figcaption>{leftItem?.label}</figcaption>
   </figure>
   <figure>
    {rightItem&&urls[rightItem.id]?<img src={urls[rightItem.id]} alt={rightItem.label}/>:<p>Готовим правую проекцию…</p>}
    <figcaption>{rightItem?.label}</figcaption>
   </figure>
  </div>
  <PlainImageAnalysis key={chosen.map(item=>item.id).join(",")} views={chosen}/>
 </section>;
}
