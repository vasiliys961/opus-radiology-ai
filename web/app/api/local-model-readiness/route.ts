/** Original research-model readiness; localhost-only, no patient data. */
import {NextRequest,NextResponse} from "next/server";
import {probeOriginalFleet,WORKERS} from "../../../lib/original-worker-fleet";
import {readLoopbackTokens} from "../../../lib/loopback-session";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const HEAD={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const HOST=/^(?:127\.0\.0\.1|localhost):[0-9]{1,5}$/;
function allowedHost(req:NextRequest){
 const host=req.headers.get("host")??"";
 const origin=req.headers.get("origin");
 return process.env.NODE_ENV==="development"&&
   HOST.test(host)&&["localhost","127.0.0.1"].includes(req.nextUrl.hostname)&&
   (origin===null||origin==="http://"+host)&&
   (req.headers.get("sec-fetch-site")??"same-origin")==="same-origin"&&
   !req.nextUrl.search;
}
export async function GET(req:NextRequest){
 if(!allowedHost(req))return NextResponse.json({error:"Private research local-only"},
   {status:404,headers:HEAD});
 const saved=readLoopbackTokens();
 const secrets:Record<string,string|undefined>=Object.fromEntries(WORKERS.map(w=>[w.env,process.env[w.env]||saved[w.env]]));
 for(const key of ["OPUS_NODULE_WORKER_TOKEN","OPUS_MONAI_PRIVATE_TUNNEL_URL","OPUS_MONAI_PRIVATE_WORKER_TOKEN"])
  secrets[key]=process.env[key]||saved[key];
 const origin=process.env.OPUS_LOCAL_WORKER_ORIGIN??"http://127.0.0.1:3000";
 if(!/^http:\/\/(?:127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(origin))
   return NextResponse.json({error:"Invalid local origin"},
     {status:503,headers:HEAD});
 const entries=await probeOriginalFleet(secrets,origin);
 return NextResponse.json({schema:"opus-original-worker-fleet/v1",
   activeCapabilitiesProbed:true,entries,externalLLMStatus:"not_checked",
   patientMode:false,originalWeightsMayStillRequireInstallation:true,
   clinicalValidation:false},{headers:HEAD});
}
