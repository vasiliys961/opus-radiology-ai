import {NextRequest,NextResponse} from "next/server";
import {createVolumeSession,validateVolumeSession,VOLUME_SESSION_COOKIE,
  localResearchEnabled,constantTimeOperatorMatch,validLocalClinicalOrigin} from "../../../../lib/volume-operator-session";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const HEADERS={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
function local(req:NextRequest){
 const host=req.headers.get("host")??"";
 return /^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/.test(host)&&
  ["localhost","127.0.0.1"].includes(req.nextUrl.hostname)&&
  [null,"same-origin"].includes(req.headers.get("sec-fetch-site"))&&!req.nextUrl.search;
}
export async function GET(req:NextRequest){
 if(!local(req))return NextResponse.json({ready:false},{status:404,headers:HEADERS});
 const enabled=localResearchEnabled();
 const alreadyConnected=enabled&&validateVolumeSession(req.cookies.get(VOLUME_SESSION_COOKIE)?.value??null);
 // Explicit administrator deployment policy: this workstation is pre-authorized
 // for *public deidentified research data only*. Never infer this from a doctor
 // visiting the page; a separate server-side flag is required.
 const autoConnect=enabled&&!alreadyConnected&&
   process.env.RADIOLOGY_LOCAL_RESEARCH_AUTO_CONNECT==="1"&&
   [null,"same-origin"].includes(req.headers.get("sec-fetch-site"));
 const response=NextResponse.json({ready:enabled,workstationConnected:alreadyConnected||autoConnect},
   {headers:HEADERS});
 if(autoConnect)response.cookies.set(VOLUME_SESSION_COOKIE,createVolumeSession(),{
   httpOnly:true,sameSite:"strict",secure:false,path:"/api/ai",maxAge:4*60*60,
 });
 return response;
}
export async function POST(req:NextRequest){
 if(!localResearchEnabled()||!local(req)||
    !validLocalClinicalOrigin(req,req.nextUrl.hostname))
    return NextResponse.json({error:"Local research unavailable"},{status:404,headers:HEADERS});
 if(!constantTimeOperatorMatch(req.headers.get("x-opus-local-operator-token")))
    return NextResponse.json({error:"Operator verification failed"},{status:401,headers:HEADERS});
 const response=NextResponse.json({workstationConnected:true},{headers:HEADERS});
 response.cookies.set(VOLUME_SESSION_COOKIE,createVolumeSession(),{
  httpOnly:true,sameSite:"strict",secure:false,path:"/api/ai",maxAge:4*60*60,
 });
 return response;
}
