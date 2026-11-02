/** Real localhost session smoke: NO cloud provider call, NO DICOM images.
 * A pre-approved public research workstation must reconnect on npm run dev
 * using only its already saved provider config, without a separate token.
 */
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
const port=await new Promise((resolve,reject)=>{
 const p=createServer();p.once("error",reject);
 p.listen(0,"127.0.0.1",()=>{
   const a=p.address();p.close(()=>resolve(a.port));
 });
});
const host="http://127.0.0.1:"+port;
const env={...process.env,NODE_ENV:"development",
 OPENROUTER_API_KEY:"test-synthetic-provider-key-no-network-00000000",
 RADIOLOGY_ENABLE_AUTOMATIC_PUBLIC_VOLUME_RESEARCH:"1",
 RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT:"1",
 RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED:"1",
 RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN:"",
 RADIOLOGY_LOCAL_RESEARCH_AUTO_CONNECT:"",
};
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","dev",
 "--hostname","127.0.0.1","--port",String(port)],{
 cwd:join(root,"web"),env,stdio:["ignore","pipe","pipe"]
});
let logs="";
server.stdout.on("data",b=>logs=(logs+String(b)).slice(-1400));
server.stderr.on("data",b=>logs=(logs+String(b)).slice(-1400));
const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),120000);
try{
 const url=host+"/api/ai/volume-operator-session";
 let res;
 for(let i=0;i<110;i++){
   try{
     res=await fetch(url,{cache:"no-store",signal:ctl.signal,
       headers:{"sec-fetch-site":"same-origin"}});
     if(res.ok)break;
   }catch(e){if(ctl.signal.aborted)throw e;}
   await new Promise(r=>setTimeout(r,750));
 }
 assert.equal(res?.status,200,"Local Next server session did not start. "+logs);
 const data=await res.json();
 assert.deepEqual(data,{ready:true,workstationConnected:true,status:"ready"});
 const setCookie=res.headers.get("set-cookie")??"";
 assert.match(setCookie,/opus_volume_operator=v1\./);
 assert.match(setCookie,/path=\/api\/ai/i);
 const cookie=setCookie.split(";")[0];
 const second=await fetch(url,{signal:ctl.signal,headers:{
   cookie,"sec-fetch-site":"same-origin",
 }});
 assert.equal(second.status,200);
 const value=await second.json();
 assert.equal(value.workstationConnected,true);
 assert.equal(value.status,"ready");
 // Intentionally use the WRONG content type. An approved session must reach
 // validation (415) but neither route must call a paid provider.
 for(const route of ["approved-volume-gemini-batch","complete-volume-opus"]){
   const result=await fetch(host+"/api/ai/"+route,{
     method:"POST",signal:ctl.signal,headers:{
       cookie,origin:host,"sec-fetch-site":"same-origin",
       "x-opus-auto-public-volume":"1","content-type":"text/plain",
     },body:"synthetic-no-provider-request",
   });
   assert.equal(result.status,415,route+" should accept signed session before payload validation");
 }
 const cross=await fetch(url,{signal:ctl.signal,headers:{"sec-fetch-site":"cross-site"}});
 assert.equal(cross.status,404);
 console.log("PASS: npm dev localhost signed session restored automatically with existing approval and no operator token");
}finally{
 clearTimeout(timeout);ctl.abort();
 server.kill("SIGTERM");
}
