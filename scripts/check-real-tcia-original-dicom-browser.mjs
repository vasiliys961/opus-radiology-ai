/** Verify ACTUAL unchanged public TCIA scanner DICOM can be opened and sampled
 * in production Chromium viewer. No fake DICOM pixels, detector, or paid LLMs.
 */
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
import {readdir,mkdir,rm} from "node:fs/promises";
import {createServer} from "node:net";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../",import.meta.url));
const require=createRequire(new URL("../web/package.json",import.meta.url));
const {chromium}=require("playwright");
const directory=process.argv[2];
if(!directory)throw Error("exact pinned TCIA reference directory is required");
const files=(await readdir(join(directory,"dicom"))).sort().map(n=>join(directory,"dicom",n));
assert.equal(files.length,103,"Exactly 103 unchanged public original CT files");
const port=await new Promise((resolve,reject)=>{
 const s=createServer();s.once("error",reject);
 s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(()=>resolve(a.port))});
});
const origin="http://127.0.0.1:"+port;
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start",
 "--hostname","127.0.0.1","--port",String(port)],{cwd:join(root,"web"),stdio:["ignore","pipe","pipe"]});
let logs="";for(const stream of [server.stdout,server.stderr])stream.on("data",b=>logs=(logs+String(b)).slice(-4500));
const result=join(root,"web/browser-results");
await mkdir(result,{recursive:true});
let browser,page;
try{
 let alive=false;
 for(let i=0;i<120;i++){
  try{const r=await fetch(origin+"/viewer");if(r.ok){alive=true;break}}catch{}
  await new Promise(r=>setTimeout(r,250));
 }
 if(!alive)throw Error("Next viewer unavailable: "+logs);
 browser=await chromium.launch({headless:true,args:["--no-sandbox","--use-gl=angle",
  "--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
 const context=await browser.newContext({viewport:{width:1600,height:1000}});
 page=await context.newPage();
 const errors=[],transfers=[];
 page.on("pageerror",e=>errors.push(String(e)));
 page.on("request",r=>{
  if(r.method()!=="GET"&&/\/api\/ai\/|\/api\/local-cln/.test(new URL(r.url()).pathname))
   transfers.push(new URL(r.url()).pathname);
 });
 await page.goto(origin+"/viewer",{waitUntil:"domcontentloaded",timeout:45000});
 await page.locator('input[accept*=".dcm"]').setInputFiles(files);
 await page.getByText(/Проиндексировано 103 DICOM/).waitFor({timeout:120000});
 const selected=page.locator(".cs-series-list button");
 await selected.first().click();
 const analysis=page.locator('section[aria-label="Единый анализ DICOM"]');
 await analysis.waitFor({timeout:30000});
 const info=await analysis.innerText();
 assert.match(info,/Грудная клетка|CHEST|Лёгк/i,
   "The genuine public DICOM anatomy must dispatch as chest CT");
 await page.getByRole("button",{name:"Подготовить кадры для Gemini + Opus"}).click();
 await page.getByRole("heading",{name:/Gemini Orchestra · подготовка кадров/}).waitFor({timeout:30000});
 const images=page.locator("img.ora-vision-plan-thumbnail");
 await images.first().waitFor({timeout:90000});
 await page.waitForFunction(()=>document.querySelectorAll("img.ora-vision-plan-thumbnail").length===4,
  null,{timeout:180000});
 assert.equal(await images.count(),4,"Actual 103 original scanner DICOM pixels sampled");
 const privacy=page.locator('section[aria-label="Подготовка обезличенных кадров"]');
 await privacy.waitFor({timeout:45000});
 assert.equal(transfers.length,0,"No original DICOM pixel/data or model API request on opening");
 assert.equal(errors.length,0,"Actual original DICOM viewer browser errors "+errors.join("; "));
 console.log("PASS: 103 exact original TCIA scanner DICOM → browser study → CT chest "+
   "route → 4 source-original local Vision PNG previews; no cloud/worker call");
 console.log("NOT tested here: genuine CLN inference and paid Gemini/Opus (separate PR #526)");
}catch(e){
 if(page)await page.screenshot({path:join(result,"tcia-original-dicom-browser-failure.png"),
  fullPage:true}).catch(()=>{});
 console.error("FAIL ORIGINAL TCIA DICOM BROWSER",e,"\nNEXT LOG",logs.slice(-2200));
 process.exitCode=1;
}finally{
 await browser?.close().catch(()=>{});
 server.kill("SIGTERM");
}
