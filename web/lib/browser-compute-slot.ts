/** Same-tab admission only; OS/worker resource guards remain necessary. */
let active:symbol|null=null;
type Kind="privacy-ocr"|"privacy-restore"|"local-r231"|"native-ct-export";
const waiters=new Set<()=>void>();
export function acquireBrowserCompute(kind:Kind):()=>void {
  if(active)throw new Error("Дождитесь завершения OCR/R231, экспорта КТ или восстановления копий, либо отмените текущую задачу, затем повторите.");
  const owner=Symbol(kind);active=owner;
  return ()=>{if(active===owner){active=null;for(const ready of [...waiters])ready();}};
}
/** Allow an aborted OCR worker's bounded teardown to finish before its
 * replacement starts (including React Strict Mode replay). Still one owner. */
export function acquireBrowserComputeWhenAvailable(kind:Kind,signal:AbortSignal,
 timeoutMs=3000):(()=>void)|Promise<()=>void>{
 signal.throwIfAborted();
 if(!active)return acquireBrowserCompute(kind);
 return new Promise((resolve,reject)=>{
  const finish=(action:()=>void)=>{clearTimeout(timer);waiters.delete(ready);
   signal.removeEventListener("abort",abort);action();};
  const ready=()=>{if(!active)finish(()=>resolve(acquireBrowserCompute(kind)));};
  const abort=()=>finish(()=>reject(new DOMException("Подготовка отменена.","AbortError")));
  const timer=setTimeout(()=>finish(()=>reject(new Error(
   "Локальный вычислитель занят. Дождитесь завершения текущей обработки и повторите OCR."))),timeoutMs);
  waiters.add(ready);signal.addEventListener("abort",abort,{once:true});
  if(signal.aborted)abort();else ready();
 });
}
