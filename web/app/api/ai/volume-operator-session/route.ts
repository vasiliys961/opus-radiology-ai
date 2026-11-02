import {NextRequest,NextResponse} from "next/server";
import {createVolumeSession,validateVolumeSession,VOLUME_SESSION_COOKIE,
  localResearchEnabled,localResearchStatus,constantTimeOperatorMatch,validLocalClinicalOrigin} from "../../../../lib/volume-operator-session";
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
 const status=localResearchStatus();
 const enabled=status==="ready";
 const alreadyConnected=enabled&&validateVolumeSession(req.cookies.get(VOLUME_SESSION_COOKIE)?.value??null);
 // Automatic connection only uses prior administrator approval and the local
 // provider key. It does not start inference or approve new medical images.
 // An explicit "0" remains an administrator off-switch.
 const autoConnect=enabled&&!alreadyConnected&&
   process.env.RADIOLOGY_LOCAL_RESEARCH_AUTO_CONNECT!=="0"&&
   [null,"same-origin"].includes(req.headers.get("sec-fetch-site"));
 const response=NextResponse.json({
   ready:enabled,workstationConnected:alreadyConnected||autoConnect,status,
 },{headers:HEADERS});
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
