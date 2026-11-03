"use client";
import {useEffect,useRef,useState} from 'react';
export default function StudyReportDiscussion({report,coverage}:{report:string;coverage:string}){
 const [english,setEnglish]=useState(''),[context,setContext]=useState(''),[question,setQuestion]=useState('');
 const [reviewed,setReviewed]=useState(false),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [history,setHistory]=useState<Array<{role:'user'|'assistant';content:string}>>([]);
 const active=useRef<AbortController|null>(null),version=useRef(report);
 useEffect(()=>{active.current?.abort();version.current=report;setEnglish('');setHistory([]);setReviewed(false);setNotice('');setBusy(false);return()=>active.current?.abort();},[report]);
 async function send(mode:'translate'|'discuss'){
  if(busy||!reviewed)return;
  const c=new AbortController();active.current=c;const source=report;setBusy(true);setNotice('Opus выполняет платный '+(mode==='translate'?'перевод…':'разбор вопроса…'));
  try{
   const response=await fetch('/api/ai/complete-volume-opus',{method:'POST',credentials:'same-origin',signal:c.signal,headers:{'Content-Type':'application/json','X-Opus-Reviewed-Volume':'1'},body:JSON.stringify({mode,report,coverage,clinicalContext:context,question:mode==='translate'?'':question,history:mode==='translate'?[]:history.slice(-8),acknowledgeReviewedText:true})});
   if(!response.ok)throw Error(response.status===429?'Opus занят или достигнут лимит обсуждения/перевода (8 за 20 минут). Повторите позже.':'Ответ не получен ('+response.status+'). Автоматического платного повтора нет.');
   const d=await response.json();if(typeof d.text!=='string'||!d.physicianReviewRequired)throw Error('Неподтверждённый ответ.');
   if(version.current!==source||c.signal.aborted)return;
   if(mode==='translate')setEnglish(d.text);else{setHistory(h=>[...h,{role:'user',content:question},{role:'assistant',content:d.text}]);setQuestion('');}
   setNotice('Готово: '+d.receipt.inputTokens+' входных / '+d.receipt.outputTokens+' выходных токенов.');
  }catch(e){if(!c.signal.aborted)setNotice(e instanceof Error?e.message:'Ответ не получен.');}
  finally{if(active.current===c)setBusy(false);}
 }
 function saveEnglish(){const u=URL.createObjectURL(new Blob([english],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download='provisional-report-en.txt';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
 return <section aria-label="Перевод и обсуждение заключения"><h3>Заключение на английском и вопросы Opus</h3>
  <p>Русское заключение можно редактировать ниже. Перевод и каждый вопрос — отдельный платный запрос Opus. Обсуждение получает текст и охват, а не новые снимки. После изменения русского текста перевод и обсуждение сбрасываются.</p>
  <label>Клинические данные без идентификации пациента<textarea disabled={busy} maxLength={4000} value={context} onChange={e=>{setContext(e.target.value);setReviewed(false);}} placeholder="Жалобы, длительность, значимый анамнез, лабораторные данные. Без ФИО, дат рождения и контактов."/></label>
  <label><input type="checkbox" disabled={busy} checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>Проверил текст заключения, вопроса и клинических данных: идентифицирующих сведений нет, передача разрешена.</label>
  <button type="button" disabled={busy||!reviewed} onClick={()=>void send('translate')}>Перевести заключение на английский (платный Opus)</button>
  {english&&<><label>English provisional report · physician review required<textarea rows={16} style={{width:'100%'}} value={english} onChange={e=>setEnglish(e.target.value)}/></label><button type="button" onClick={saveEnglish}>Сохранить английское заключение TXT</button></>}
  {history.map((m,i)=><p key={i} style={{whiteSpace:'pre-wrap'}}><strong>{m.role==='user'?'Вопрос врача: ':'Ответ Opus: '}</strong>{m.content}</p>)}
  <label>Вопрос по результату<textarea disabled={busy} maxLength={2000} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Какие признаки поддерживают этот вывод? Что уточнить с учётом анамнеза?"/></label>
  <button type="button" disabled={busy||!reviewed||!question.trim()} onClick={()=>void send('discuss')}>Обсудить с Opus (платный запрос)</button>
  {busy&&<button type="button" onClick={()=>{active.current?.abort();setBusy(false);setNotice('Остановлено. Уже начатый запрос мог быть оплачен.');}}>Остановить ожидание</button>}
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
