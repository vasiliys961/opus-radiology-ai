export function readyWmhOriginal(x:unknown):boolean{
 if(!x||typeof x!=="object"||Array.isArray(x))return false;
 const v=x as Record<string,unknown>;
 return v.schema==="opus-direct-wmh-worker/v1"&&v.originalModelReady===true&&
 v.patientMode===false&&v.imageUpload===true&&
 v.dataPolicy==="approved-public-research-only"&&v.modelVersion==="1.6.0";
}
