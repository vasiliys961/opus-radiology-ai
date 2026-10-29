/** Private local WMH FLAIR runner bridge. Public nonpatient research only. */
import {NextRequest,NextResponse} from "next/server";
import {readyWmhOriginal} from "../../../lib/auto-wmh-ready";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=800;
const WORKER="http://127.0.0.1:8772";
const HEAD={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const fail=(status:number,error:string)=>NextResponse.json({error},{status,headers:HEAD});
function allowed(req:NextRequest,post:boolean):boolean{
 const host=req.headers.get("host")??"",origin=req.headers.get("origin");
 return process.env.NODE_ENV==="development"&&/^(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(host)&&
 ["127.0.0.1","localhost"].includes(req.nextUrl.hostname)&&!req.nextUrl.search&&
 (post?origin==="http://"+host:(origin===null||origin==="http://"+host))&&
 (req.headers.get("sec-fetch-site")??"same-origin")==="same-origin";
}
function creds(){
 const token=process.env.OPUS_WMH_WORKER_TOKEN??"";
 const origin=process.env.OPUS_LOCAL_WORKER_ORIGIN??"http://127.0.0.1:3000";
 return /^[A-Za-z0-9_-]{32,128}$/.test(token)&&
 /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(origin)?{token,origin}:null;
}
async function bounded(res:Response,max:number):Promise<unknown>{
 const reader=res.body?.getReader();if(!reader)throw Error("empty");
 let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const {value,done}=await reader.read();if(done)break;
  size+=value.byteLength;if(size>max)throw Error("oversized");
  chunks.push(value);
 }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const data=new Uint8Array(size);let pos=0;
 for(const c of chunks){data.set(c,pos);pos+=c.length;}
 return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(data));
}
async function capability(c:{token:string;origin:string},signal:AbortSignal){
 const res=await fetch(WORKER+"/v1/wmh/capabilities",{
  headers:{Authorization:"Bearer "+c.token,Origin:c.origin},cache:"no-store",redirect:"error",
  signal:AbortSignal.any([signal,AbortSignal.timeout(3500)])});
 if(!res.ok)throw Error("unavailable");
 const v=await bounded(res,16384);
 if(!readyWmhOriginal(v))throw Error("original WMH unavailable");
 return v;
}
export async function GET(req:NextRequest){
 if(!allowed(req,false))return fail(404,"Local research only");
 const c=creds();if(!c)return fail(503,"WMH not configured");
 try{return NextResponse.json(await capability(c,req.signal),{headers:HEAD});}
 catch{return fail(503,"Original WMH unavailable");}
}
export async function POST(req:NextRequest){
 if(!allowed(req,true))return fail(404,"Local research only");
 if(req.headers.get("x-opus-public-research-authorization")!=="approved-nonpatient-source"||
    !/^multipart\/form-data; boundary=[A-Za-z0-9'()+_,.\/:=?-]{1,70}$/.test(req.headers.get("content-type")??""))
  return fail(403,"Public FLAIR research authorization required");
 const c=creds();if(!c)return fail(503,"WMH not configured");
 const max=300*16*1024*1024;
 const declared=req.headers.get("content-length");
 if(declared!==null&&(!Number.isSafeInteger(Number(declared))||Number(declared)>max||Number(declared)<1))
  return fail(413,"FLAIR upload exceeds size budget");
 if(!req.body)return fail(400,"Missing FLAIR series");
 try{
  await capability(c,req.signal);
  let size=0;
  const body=req.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
   transform(part,controller){size+=part.byteLength;if(size>max)throw Error("too large");controller.enqueue(part);}
  }));
  const init:RequestInit&{duplex:"half"}={
   method:"POST",body,duplex:"half",redirect:"error",cache:"no-store",
   headers:{"Content-Type":req.headers.get("content-type")!,Origin:c.origin,Authorization:"Bearer "+c.token},
   signal:AbortSignal.any([req.signal,AbortSignal.timeout(750000)]),
  };
  const res=await fetch(WORKER+"/v1/wmh/analyze",init);
  if(!res.ok)return fail(res.status===413?413:422,"Original WMH model did not complete");
  const v=await bounded(res,1024*1024);
  if(!v||typeof v!=="object"||Array.isArray(v)||
     (v as Record<string,unknown>).inference===null)
   return fail(422,"Invalid WMH research report");
  return NextResponse.json(v,{headers:HEAD});
 }catch{return fail(503,"Original WMH worker unavailable or cancelled");}
}
