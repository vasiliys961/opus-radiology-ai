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
 return NextResponse.json({ready:localResearchEnabled(),
  workstationConnected:localResearchEnabled()&&
   validateVolumeSession(req.cookies.get(VOLUME_SESSION_COOKIE)?.value??null)},
   {headers:HEADERS});
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
