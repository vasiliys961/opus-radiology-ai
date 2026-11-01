/** End-to-end automatic clinician UI with real synthetic DICOM pixels/OCR,
 * mocked paid Gemini/Opus HTTP responses. No provider credentials or patient data.
 */
import {createRequire} from "node:module";
import {spawn,execFileSync} from "node:child_process";
import {mkdtemp,readdir,rm} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../",import.meta.url));
const require=createRequire(new URL("../web/package.json",import.meta.url));
const {chromium}=require("playwright");
const fixture=await mkdtemp(join(tmpdir(),"opus-one-action-volume-"));
execFileSync(process.execPath,[join(root,"scripts/generate-segmentation-phantom.mjs"),
 fixture,"CT","rescale-hu","CHEST"],{stdio:"pipe"});
const port=await new Promise((resolve,reject)=>{
 const probe=createServer();probe.once("error",reject);
 probe.listen(0,"127.0.0.1",()=>{
  const address=probe.address();probe.close(()=>resolve(address.port));
 });
});
const base="http://127.0.0.1:"+port;
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start",
 "--hostname","127.0.0.1","--port",String(port)],{
 cwd:join(root,"web"),stdio:["ignore","pipe","pipe"],
});
let logs="";server.stdout.on("data",b=>logs+=String(b).slice(-1000));
server.stderr.on("data",b=>logs+=String(b).slice(-1000));
let browser;
try{
 for(let i=0;i<120;i++){
  try{const r=await fetch(base+"/viewer");if(r.ok)break;}catch{}
  if(i===119)throw Error("App did not start "+logs.slice(-1000));
  await new Promise(r=>setTimeout(r,250));
 }
 browser=await chromium.launch({headless:true,args:["--no-sandbox",
  "--use-gl=angle","--use-angle=swiftshader",
  "--enable-unsafe-swiftshader"]});
 const ctx=await browser.newContext({viewport:{width:1600,height:1000},
  acceptDownloads:true});
 const page=await ctx.newPage(),errors=[];
 page.on("pageerror",e=>errors.push(e.message));
 let geminiCalls=0,opusCalls=0;
 await page.route("**/api/ai/volume-operator-session",route=>
  route.fulfill({status:200,contentType:"application/json",
   body:JSON.stringify({ready:true,workstationConnected:true})}));
 await page.route("**/api/ai/approved-volume-gemini-batch",async route=>{
  geminiCalls++;
  const request=route.request(),body=request.postDataJSON(),frames=body.packet.frames;
  assert.equal(request.headers()["x-opus-auto-public-volume"],"1");
  assert.equal(body.acknowledgeAutomaticOCRAndNoPerFramePhysicianReview,true);
  assert.equal(body.packet.schema,"opus-public-volume-auto-ocr/v1");
  assert.ok(frames.length>=1&&frames.length<=4);
  for(const frame of frames){
   assert.match(frame.sha256,/^[a-f0-9]{64}$/);
   assert.equal(frame.ocrClear,true);assert.equal(frame.ocrSha256,frame.sha256);
  }
  for(const forbidden of ["PatientName","SOPInstanceUID","StudyInstanceUID"])
   assert.ok(!JSON.stringify(body).includes(forbidden));
  const result={schema:"opus-gemini-volume-batch/v1",model:"google/gemini-3.8-flash",
   modality:"CT",imagesReviewed:frames.length,
   reviewedImageIds:frames.map(f=>f.frameId),
   observations:[{id:"obs-"+geminiCalls,imageId:"frame-1",
    anatomy:"синтетический фантом",sign:"только учебный объект",
    uncertainty:"нет клинических данных"}],
   limitations:["Исследовательский тест"],receipt:{inputTokens:520,outputTokens:120},
   clinicalValidation:false,sourceBindingsLocalOnly:true};
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(result)});
 });
 const protocol="ИССЛЕДОВАНИЕ:\nУчебная КТ грудной клетки.\n"+
  "МЕТОДИКА:\nИзображения обработаны Gemini; Opus сопоставил только структурированные данные.\n"+
  "ОПИСАНИЕ:\nОценён синтетический объект на учебных изображениях. Клинические выводы не формируются.\n"+
  "ЗАКЛЮЧЕНИЕ:\nИсследовательский программный тест, не диагноз.\n"+
  "РЕКОМЕНДАЦИИ:\nДля реального исследования требуется оценка врача-рентгенолога.";
 await page.route("**/api/ai/complete-volume-opus",async route=>{
  opusCalls++;
  const data=route.request().postDataJSON();
  assert.equal(data.schema,"opus-volume-synthesis-request/v1");
  assert.equal(data.detectorState,"completed");
  assert.equal(data.overviewReviewed,8);
  assert.equal(data.observations.length,2);
  assert.equal(data.acknowledgePaidOpusSynthesis,true);
  assert.equal(route.request().headers()["x-opus-auto-public-volume"],"1");
  await route.fulfill({status:200,contentType:"application/json",
   body:JSON.stringify({schema:"opus-full-volume-radiologist/v1",
    modality:"CT",overviewReviewed:8,plannedFrames:8,
    finalReport:protocol,limitations:[],clinicalValidation:false,
    physicianSignatureRequired:true,receipt:{inputTokens:900,outputTokens:200}})});
 });
 await page.goto(base+"/viewer",{waitUntil:"domcontentloaded",timeout:50000});
 const all=(await readdir(join(fixture,"dicom"))).sort();
 const files=all.slice(0,8).map(n=>join(fixture,"dicom",n));
 assert.equal(files.length,8);
 await page.locator('input[accept*=".dcm"]').setInputFiles(files);
 await page.getByText(/Проиндексировано 8 DICOM/).waitFor({timeout:45000});
 await page.locator(".cs-series-list button").first().click();
 const primary=page.locator('section[aria-label="Единый анализ DICOM"]');
 await primary.waitFor();
 const research=primary.getByRole("checkbox",{name:/Подтверждаю, что исследование разрешено/});
 await research.check();
 const button=primary.getByRole("button",{name:"Анализировать исследование"});
 await page.waitForFunction(()=>{
  const area=document.querySelector('section[aria-label="Единый анализ DICOM"]');
  const b=[...(area?.querySelectorAll("button")??[])].find(x=>
   x.textContent?.trim()==="Анализировать исследование");
  return !!b&&!b.disabled;
 },null,{timeout:90000});
 assert.equal(geminiCalls,0);
 await button.click();
 const section=page.locator('section[aria-label="Автоматический анализ исследования"]');
 await section.waitFor({timeout:45000});
 await section.getByText(/Описание и заключение готовы/).waitFor({timeout:240000});
 assert.equal(geminiCalls,2);
 assert.equal(opusCalls,1);
 const editor=section.locator("textarea");
 assert.match(await editor.inputValue(),/ЗАКЛЮЧЕНИЕ:/);
 assert.equal(await primary.getByRole("button",{name:"Анализировать исследование"}).count(),1);
 assert.deepEqual(errors,[]);
 console.log("PASS: one clinical click -> all 8 original synthetic CT slices -> 2 Gemini packets -> single Opus report (providers mocked)");
}finally{
 await browser?.close().catch(()=>{});
 server.kill("SIGTERM");
 await rm(fixture,{recursive:true,force:true});
}
