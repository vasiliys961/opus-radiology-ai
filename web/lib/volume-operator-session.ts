/** Secure operator-established local browser session: clinician is never shown
 * backend tokens. A server-validated HttpOnly cookie is short lived and scoped
 * only to explicit deidentified PUBLIC research studies on localhost.
 */
import {createHmac,timingSafeEqual} from "node:crypto";
export const VOLUME_SESSION_COOKIE="opus_volume_operator";
const MAX_AGE_MS=4*60*60*1000;
export function localResearchEnabled():boolean{
 return process.env.NODE_ENV==="development"&&
   process.env.RADIOLOGY_ENABLE_AUTOMATIC_PUBLIC_VOLUME_RESEARCH==="1"&&
   process.env.RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT==="1"&&
   process.env.RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED==="1"&&
   !!process.env.OPENROUTER_API_KEY?.trim()&&
   (process.env.RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN?.length??0)>=24;
}
function signingKey():string{
 const secret=process.env.RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN;
 if(!secret||secret.length<24)throw Error("Trusted local operator is not configured");
 return secret;
}
export function createVolumeSession(now=Date.now()):string{
 const expires=String(now+MAX_AGE_MS);
 const payload="v1."+expires;
 const signature=createHmac("sha256",signingKey()).update("volume-session:"+payload).digest("hex");
 return payload+"."+signature;
}
export function validateVolumeSession(value:string|undefined|null,now=Date.now()):boolean{
 if(!value||value.length>160)return false;
 const parts=value.split(".");
 if(parts.length!==3||parts[0]!=="v1"||!/^1[0-9]{12}$/.test(parts[1])||
   !/^[a-f0-9]{64}$/.test(parts[2]))return false;
 const expires=Number(parts[1]);
 if(!Number.isSafeInteger(expires)||expires<=now||expires>now+MAX_AGE_MS)return false;
 let expected:string;
 try{expected=createHmac("sha256",signingKey())
   .update("volume-session:v1."+parts[1]).digest("hex");}catch{return false;}
 const a=Buffer.from(expected,"hex"),b=Buffer.from(parts[2],"hex");
 return a.length===b.length&&timingSafeEqual(a,b);
}
export function validLocalClinicalOrigin(req:Request,hostname:string):boolean{
 const headers=req.headers;
 const host=headers.get("host")??"";
 return /^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/.test(host)&&
   ["localhost","127.0.0.1"].includes(hostname)&&
   headers.get("origin")==="http://"+host&&
   [null,"same-origin"].includes(headers.get("sec-fetch-site"));
}
export function constantTimeOperatorMatch(value:string|null):boolean{
 const expected=process.env.RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN;
 if(!expected||expected.length<24||!value||value.length>512)return false;
 const a=Buffer.from(value,"utf8"),b=Buffer.from(expected,"utf8");
 return a.length===b.length&&timingSafeEqual(a,b);
}
