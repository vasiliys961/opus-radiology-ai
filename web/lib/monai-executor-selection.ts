/** Server-only selection of the SAME original model. No arbitrary remote URLs,
 * downloads, inference retries, browser secrets or public/patient-policy change.
 * A private Linux worker is reached through an administrator-owned SSH tunnel.
 */
import {createHmac,timingSafeEqual} from "node:crypto";
import {verifiedOriginalNoduleWorker} from "./live-nodule-worker.ts";
type Env=Readonly<Record<string,string|undefined>>;
export type MonaiExecutor={id:"local"|"private";url:string;token:string;origin:string};
export type MonaiExecutorStatus="not_configured"|"unreachable"|"unverified"|"not_ready"|"ready";
export type MonaiSelection={executor:MonaiExecutor|null;capability:Record<string,unknown>|null;
 attempts:{location:MonaiExecutor["id"];status:MonaiExecutorStatus}[]};
const TOKEN=/^[a-zA-Z0-9_-]{32,128}$/;
const JOB=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const AGE=4*60*60*1000;
export function configuredMonaiExecutors(env:Env):MonaiExecutor[]{
 const origin=env.OPUS_LOCAL_WORKER_ORIGIN??"http://127.0.0.1:3000";
 if(!/^http:\/\/(?:127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(origin))return [];
 const entries:MonaiExecutor[]=[];
 const localToken=env.OPUS_MONAI_WORKER_TOKEN??env.OPUS_NODULE_WORKER_TOKEN??"";
 if(TOKEN.test(localToken))entries.push({id:"local",url:"http://127.0.0.1:8768",token:localToken,origin});
 const tunnel=env.OPUS_MONAI_PRIVATE_TUNNEL_URL??"";
 const match=/^http:\/\/127\.0\.0\.1:([0-9]{4,5})$/.exec(tunnel);
 const token=env.OPUS_MONAI_PRIVATE_WORKER_TOKEN??"";
 if(match&&Number(match[1])>=1024&&Number(match[1])<=65535&&Number(match[1])!==8768&&TOKEN.test(token))
  entries.push({id:"private",url:tunnel,token,origin});
 return entries;
}
export function monaiExecutorHeaders(executor:MonaiExecutor):Record<string,string>{
 // Keep equal local/remote tunnel ports so the original strict worker Host
 // check remains intact. Do not attempt to rewrite Host through fetch.
 return {Authorization:"Bearer "+executor.token,Origin:executor.origin};
}
export async function boundedMonaiJson(response:Response,max:number):Promise<Record<string,unknown>>{
 const reader=response.body?.getReader();if(!reader)throw Error("empty_response");
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;
  size+=value.byteLength;if(size>max)throw Error("oversized_response");chunks.push(value);
 }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;
 for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 const parsed:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
 if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error("invalid_response");
 return parsed as Record<string,unknown>;
}
export async function selectMonaiExecutor(env:Env,signal:AbortSignal,call:typeof fetch=fetch):Promise<MonaiSelection>{
 const attempts:MonaiSelection["attempts"]=[];
 for(const executor of configuredMonaiExecutors(env)){
  signal.throwIfAborted();
  try{
   const response=await call(executor.url+"/v1/nodule/capabilities",{
    method:"GET",cache:"no-store",redirect:"error",
    headers:monaiExecutorHeaders(executor),
    signal:AbortSignal.any([signal,AbortSignal.timeout(2500)]),
   });
   if(!response.ok){attempts.push({location:executor.id,status:"unreachable"});continue;}
   const capability=await boundedMonaiJson(response,16384);
   if(!verifiedOriginalNoduleWorker(capability)||capability.imageUpload!==true){
    attempts.push({location:executor.id,status:"unverified"});continue;
   }
   if(capability.ready!==true){attempts.push({location:executor.id,status:"not_ready"});continue;}
   attempts.push({location:executor.id,status:"ready"});
   return {executor,capability,attempts};
  }catch{
   signal.throwIfAborted();attempts.push({location:executor.id,status:"unreachable"});
  }
 }
 return {executor:null,capability:null,attempts};
}
/** The client carries an opaque, signed route binding, never worker credentials.
 * Poll/report/cancel use the ORIGINAL executor even if readiness later changes. */
export function monaiJobBinding(executor:MonaiExecutor,jobId:string,now=Date.now()):string{
 if(!JOB.test(jobId))throw Error("invalid_job");
 const payload=["v1",executor.id,jobId,String(now+AGE)].join(".");
 const signature=createHmac("sha256",executor.token)
  .update("opus-monai-job:"+executor.url+":"+executor.origin+":"+payload).digest("hex");
 return payload+"."+signature;
}
export function boundMonaiExecutor(env:Env,value:string|null,jobId:string,now=Date.now()):MonaiExecutor|null{
 if(!value||value.length>240||!JOB.test(jobId))return null;
 const p=value.split(".");
 if(p.length!==5||p[0]!=="v1"||p[2]!==jobId||!/^1[0-9]{12}$/.test(p[3])||
  !/^[a-f0-9]{64}$/.test(p[4]))return null;
 const expires=Number(p[3]);if(expires<=now||expires>now+AGE)return null;
 const executor=configuredMonaiExecutors(env).find(c=>c.id===p[1]);if(!executor)return null;
 const expected=monaiJobBinding(executor,jobId,expires-AGE).split(".")[4];
 return timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(p[4],"hex"))?executor:null;
}
