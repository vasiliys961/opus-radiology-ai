/** Local operator session for individually reviewed PNGs. Never authorizes
 * automatic whole-volume upload or certifies de-identification. */
import {createHmac,timingSafeEqual} from "node:crypto";
export const REVIEWED_FRAME_COOKIE="opus_reviewed_frames_operator";
const AGE=4*60*60*1000;
type Env=Readonly<Record<string,string|undefined>>;
export function reviewedFrameConnectionStatus(env:Env=process.env):
 "ready"|"not-development"|"missing-provider"|"not-approved"|"operator-required"{
 if(env.NODE_ENV!=="development")return "not-development";
 if(!env.OPENROUTER_API_KEY?.trim())return "missing-provider";
 if(env.RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT!=="1"||
  env.RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED!=="1")return "not-approved";
 return env.RADIOLOGY_LOCAL_REVIEWED_FRAME_SESSION==="1"||
  (env.RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN?.length??0)>=24?"ready":"operator-required";
}
export function reviewedFrameSessionEnabled(env:Env=process.env):boolean{
 return env.NODE_ENV==="development"&&
  env.RADIOLOGY_LOCAL_REVIEWED_FRAME_SESSION==="1"&&
  env.RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT==="1"&&
  env.RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED==="1"&&
  !!env.OPENROUTER_API_KEY?.trim();
}
export function createReviewedFrameSession(env:Env=process.env,now=Date.now()):string{
 if(!reviewedFrameSessionEnabled(env))throw Error("Reviewed-frame workstation not configured");
 const payload="reviewed-v1."+(now+AGE);
 return payload+"."+createHmac("sha256",env.OPENROUTER_API_KEY!.trim())
  .update("opus-individually-reviewed-png-session:"+payload).digest("hex");
}
export function validReviewedFrameSession(value:string|undefined,env:Env=process.env,now=Date.now()):boolean{
 if(!reviewedFrameSessionEnabled(env)||!value||value.length>160)return false;
 const parts=value.split(".");
 if(parts.length!==3||parts[0]!=="reviewed-v1"||!/^1[0-9]{12}$/.test(parts[1])||
  !/^[a-f0-9]{64}$/.test(parts[2]))return false;
 const expires=Number(parts[1]);
 if(expires<=now||expires>now+AGE)return false;
 const expected=createReviewedFrameSession(env,expires-AGE).split(".")[2];
 return timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(parts[2],"hex"));
}
