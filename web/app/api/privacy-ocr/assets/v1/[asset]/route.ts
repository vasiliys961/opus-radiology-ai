import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { OCR_ASSETS,OCR_HOST_SCRIPT,OCR_NETWORK_GUARD } from "../../../../../../lib/privacy-ocr-assets";
export const runtime="nodejs",dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{asset:string}>}) {
  const {asset}=await params;
  if(new URL(request.url).search)return new Response(null,{status:404});
  try{
    let bytes:Uint8Array;
    if(asset==="host-worker.js")bytes=new TextEncoder().encode(OCR_HOST_SCRIPT);
    else{
      const key=asset==="engine-worker.js"?"worker.min.js":asset;
      if(!Object.hasOwn(OCR_ASSETS,key))return new Response(null,{status:404});
      const info=OCR_ASSETS[key],file=await readFile(join(process.cwd(),"node_modules",info.path));
      if(createHash("sha256").update(file).digest("hex")!==info.sha256)return new Response(null,{status:503});
      bytes=asset==="engine-worker.js"?new TextEncoder().encode(OCR_NETWORK_GUARD+file.toString("utf8")):file;
    }
    return new Response(bytes as Uint8Array<ArrayBuffer>,{headers:{"Content-Type":asset.endsWith(".js")?"text/javascript; charset=utf-8":
      asset.endsWith(".wasm")?"application/wasm":"application/octet-stream","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
  }catch{return new Response(null,{status:503});}
}
