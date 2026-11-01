/** Recover an original CLN source ONLY when the browser's OPFS file vanished.
 * Rebuild from the selected DICOM, then re-check original SHA-256 before exposing
 * any detector-to-slice coordinates. Never substitute or fabricate model findings.
 */
export function isMissingBrowserFile(error:unknown):boolean{
 if(!error||typeof error!=="object")return false;
 const e=error as {name?:unknown;message?:unknown};
 return e.name==="NotFoundError"||
   (typeof e.message==="string"&&
    /A requested file or directory could not be found at the time an operation was processed/i.test(e.message));
}
export async function restoreMissingClnSource<T>(
 source:T,verify:(source:T)=>Promise<void>,reconstruct:()=>Promise<T>,
):Promise<{source:T;restored:boolean}>{
 try{
  await verify(source);
  return {source,restored:false};
 }catch(error){
  // A hash mismatch, geometry error or cancellation is NOT a recoverable
  // disappearance: keep the physician's slice-navigation gate closed.
  if(!isMissingBrowserFile(error))throw error;
 }
 const recovered=await reconstruct();
 await verify(recovered);
 return {source:recovered,restored:true};
}
