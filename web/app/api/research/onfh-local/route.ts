import {NextRequest,NextResponse} from "next/server";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawn} from "node:child_process";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const LOCAL=/^(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$/;
const HEADERS={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
let executing=false;
const denied=(code:number,error:string)=>NextResponse.json({error},{status:code,headers:HEADERS});
function local(req:NextRequest,post=false){
 const host=req.headers.get("host")??"";
 return process.env.NODE_ENV==="development"&&LOCAL.test(host)&&
   ["localhost","127.0.0.1"].includes(req.nextUrl.hostname)&&
   (req.headers.get("sec-fetch-site")===null||req.headers.get("sec-fetch-site")==="same-origin")&&
   (!post||req.headers.get("origin")==="http://"+host);
}
function configured(){
 const weights=process.env.OPUS_ONFH_WEIGHTS_PATH??"";
 const sha=process.env.OPUS_ONFH_WEIGHTS_SHA256??"";
 return weights.startsWith("/")&&/^[a-f0-9]{64}$/.test(sha)?{weights,sha}:null;
}
export async function GET(req:NextRequest){
 if(!local(req))return denied(404,"Local Mac workstation only");
 return NextResponse.json({schema:"opus-local-onfh-ready/v1",available:!!configured(),
  input:"selected-subject-MR-PNG-slices",cloudTransfer:false,
  note:"ONFH research weights must be downloaded locally; PNG series only."},{headers:HEADERS});
}
export async function POST(req:NextRequest){
 if(!local(req,true))return denied(404,"Local Mac workstation only");
 const cfg=configured();if(!cfg)return denied(503,"ONFH weights and SHA-256 not configured locally");
 if(executing)return denied(429,"A local ONFH inference is already running");
 const len=Number(req.headers.get("content-length")??"0");
 if(!Number.isFinite(len)||len<1||len>24*1024*1024)return denied(413,"Original PNG series exceeds 24 MB");
 if(!(req.headers.get("content-type")??"").startsWith("multipart/form-data;"))
   return denied(415,"Multipart PNG slices required");
 executing=true;
 let directory="";
 try{
   const form=await req.formData();
   if(form.get("acknowledged")!=="research-only")return denied(400,"Research limitations acknowledgement required");
   const slices=form.getAll("slices");
   if(slices.length<2||slices.length>300||!slices.every(f=>f instanceof File))
     return denied(400,"Between 2 and 300 MRI PNG slices required");
   directory=await mkdtemp(join(tmpdir(),"opus-onfh-"));
   const series=join(directory,"subject");
   const {mkdir}=await import("node:fs/promises");await mkdir(series,{mode:0o700});
   let sum=0;
   for(let i=0;i<slices.length;i++){
     const file=slices[i] as File;
     if(file.size<50||file.size>15*1024*1024||!/\.png$/i.test(file.name))
       return denied(400,"Only bounded PNG MRI slices supported");
     sum+=file.size;if(sum>24*1024*1024)return denied(413,"Subject series too large");
     const data=Buffer.from(await file.arrayBuffer());
     if(data.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")
       return denied(400,"Invalid PNG slice");
     await writeFile(join(series,String(i).padStart(3,"0")+".png"),data,{flag:"wx",mode:0o600});
   }
   const output=join(directory,"report.json");
   const script=resolve(process.cwd(),"../scripts/infer-real-jlu-onfh-local.py");
   const python=process.env.OPUS_ONFH_PYTHON??"python3";
   const args=[script,"--subject-png-dir",series,"--weights",cfg.weights,
     "--weights-sha256",cfg.sha,"--report",output];
   const status=await new Promise<number>((resolveStatus,reject)=>{
     const child=spawn(python,args,{stdio:["ignore","ignore","ignore"],env:{...process.env,PYTHONNOUSERSITE:"1"}});
     const timeout=setTimeout(()=>child.kill("SIGKILL"),90000);
     child.on("error",e=>{clearTimeout(timeout);reject(e);});
     child.on("close",code=>{clearTimeout(timeout);resolveStatus(code??1);});
   });
   if(status!==0)return denied(422,"ONFH study is incompatible, weights rejected or local execution failed");
   const report:unknown=JSON.parse(await readFile(output,"utf8"));
   if(!report||typeof report!=="object"||
     (report as {schema?:unknown}).schema!=="opus-onfh-local-preliminary-impression/v1"||
     (report as {imageOrPatientDataUploaded?:unknown}).imageOrPatientDataUploaded!==false)
     return denied(502,"ONFH inference report validation failed");
   return NextResponse.json(report,{headers:HEADERS});
 }catch{return denied(500,"Local ONFH inference failed");}
 finally{executing=false;if(directory)await rm(directory,{recursive:true,force:true});}
}
