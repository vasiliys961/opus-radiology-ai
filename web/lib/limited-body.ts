/** Bounded read of untrusted HTTP bodies. Abort oversized chunked requests
 * before JSON parsing, even with missing/spoofed Content-Length.
 */
export class HttpBodyTooLarge extends Error {
  constructor(){super("HTTP request body exceeds the allowed byte limit.");this.name="HttpBodyTooLarge";}
}
export async function readLimitedText(request:Request,maxBytes:number):Promise<string>{
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>65536)
    throw new Error("Invalid request limit.");
  const body=request.body;
  if(!body)throw new Error("Empty HTTP body.");
  const reader=body.getReader();
  const decoder=new TextDecoder("utf-8",{fatal:true});
  let received=0,text="";
  try {
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      received+=value.byteLength;
      if(received>maxBytes)throw new HttpBodyTooLarge();
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
    return text;
  }finally {
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}
