/** Same-tab admission only; OS/worker resource guards remain necessary. */
let active:symbol|null=null;
export function acquireBrowserCompute(kind:"privacy-ocr"|"local-r231"):()=>void {
  if(active)throw new Error("Дождитесь завершения OCR/R231 или отмените текущую задачу, затем повторите.");
  const owner=Symbol(kind);active=owner;
  return ()=>{if(active===owner)active=null;};
}
