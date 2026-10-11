import {NextRequest,NextResponse} from "next/server";
import {syntheticVisionFrames,SYNTHETIC_REGIONS,type SyntheticRegion}
  from "../../../../../lib/synthetic-vision-phantom";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const HEADERS={"Cache-Control":"no-store, max-age=0",
  "X-Content-Type-Options":"nosniff","Cross-Origin-Resource-Policy":"same-origin"};
const HOST=/^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/;

/** Render exactly the mathematical images that may be sent in a paid trial. */
export async function GET(request:NextRequest) {
  if(process.env.NODE_ENV!=="development" ||
      !HOST.test(request.headers.get("host")??"") ||
      !["localhost","127.0.0.1"].includes(request.nextUrl.hostname))
    return NextResponse.json({error:"Development localhost only"},
      {status:404,headers:HEADERS});
  const p=request.nextUrl.searchParams;
  if(p.size!==3 || [...p.keys()].some(k=>!["region","modality","frame"].includes(k)))
    return NextResponse.json({error:"Exact region, modality and frame required"},
      {status:400,headers:HEADERS});
  const region=p.get("region"), modality=p.get("modality"), index=p.get("frame");
  if(!SYNTHETIC_REGIONS.includes(region as SyntheticRegion) ||
      (modality!=="CT"&&modality!=="MR") || (index!=="0"&&index!=="1"))
    return NextResponse.json({error:"Invalid synthetic phantom selection"},
      {status:400,headers:HEADERS});
  const base64=syntheticVisionFrames(modality,region as SyntheticRegion)[Number(index)].base64;
  const png=new Uint8Array(Buffer.from(base64,"base64"));
  return new NextResponse(png,{headers:{...HEADERS,"Content-Type":"image/png"}});
}
