/** Same-tab admission only; OS/worker resource guards remain necessary. */
let active:symbol|null=null;
export function acquireBrowserCompute(kind:"privacy-ocr"|"privacy-restore"|"local-r231"|"native-ct-export"):()=>void {
  if(active)throw new Error("Дождитесь завершения OCR/R231, экспорта КТ или восстановления копий, либо отмените текущую задачу, затем повторите.");
  const owner=Symbol(kind);active=owner;
  return ()=>{if(active===owner)active=null;};
}
