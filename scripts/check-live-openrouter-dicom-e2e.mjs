/** One-off live paid OpenRouter E2E using synthetic DICOM only; no patient data and two model calls maximum. */
import {createRequire} from "node:module";
import {spawn,execFileSync} from "node:child_process";
import {mkdtemp,readdir,readFile,rm,mkdir} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
if(!process.env.OPENROUTER_API_KEY?.trim())throw Error("GitHub Actions OpenRouter secret is absent");
if(process.env.OPUS_SYNTHETIC_LIVE_TEST_APPROVED!=="true")throw Error("Explicit synthetic live test opt-in required");
const operatorToken=process.env.RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN;
if(!operatorToken||operatorToken.length<24)throw Error("Synthetic-only local operator token missing");
const root=fileURLToPath(new URL("../",import.meta.url));
const require=createRequire(new URL("../web/package.json",import.meta.url));
const {chromium}=require("playwright");
const fixture=await mkdtemp(join(tmpdir(),"opus-ct-vision-e2e-"));
const results=join(root,"web/browser-results");
await mkdir(results,{recursive:true});
execFileSync(process.execPath,[join(root,"scripts/generate-segmentation-phantom.mjs"),
  fixture,"CT","rescale-hu","CHEST"],{stdio:"pipe"});
const port=await new Promise((resolve,reject)=>{
 const probe=createServer();probe.once("error",reject);
 probe.listen(0,"127.0.0.1",()=>{const addr=probe.address();probe.close(()=>resolve(addr.port));});
});
const baseUrl="http://127.0.0.1:"+port;
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","dev",
 "--hostname","127.0.0.1","--port",String(port)],{cwd:join(root,"web"),stdio:["ignore","pipe","pipe"]});
let logs="";server.stdout.on("data",b=>logs+=String(b).slice(-3000));
server.stderr.on("data",b=>logs+=String(b).slice(-3000));
let browser,page;
try{
 for(let i=0;i<240;i++){
  try{const r=await fetch(baseUrl+"/viewer");if(r.ok)break;}catch{}
  if(i===119)throw Error("Next server did not start: "+logs.slice(-1500));
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 browser=await chromium.launch({headless:true,args:["--no-sandbox",
  "--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
 const context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});
 page=await context.newPage();const errors=[];const aiRequests=[];
 let posted=null,paidResult=null,postCount=0;

 page.on("pageerror",e=>errors.push(e.message));
 page.on("request",r=>{
  if(new URL(r.url()).pathname!=="/api/ai/deidentified-openrouter-review")return;
  aiRequests.push(r.method());
  if(r.method()==="POST"){
   postCount++;posted=r.postDataJSON();
   const packet=posted.packet;
   assert.equal(packet.frames.length,4);
   assert.equal(posted.acknowledgeClinicianLawfulDisclosure,true);
   assert.equal(posted.acknowledgeProviderHealthDataTerms,true);
   assert.equal(posted.acknowledgePixelIdentityReviewed,true);
   assert.equal(posted.acknowledgeTwoPaidCalls,true);
   const serialized=JSON.stringify(packet);
   for(const prohibited of ["SOPInstanceUID","StudyInstanceUID","PatientName","2.25.1043521000002"])
    assert.ok(!serialized.includes(prohibited),"DICOM source identifier leaked into OpenRouter request");
  }
 });
 page.on("response",async response=>{
   if(new URL(response.url()).pathname==="/api/ai/deidentified-openrouter-review"&&
      response.request().method()==="POST"){
      paidResult={status:response.status(),body:await response.json().catch(()=>null)};
   }
 });
 await page.goto(baseUrl+"/viewer",{waitUntil:"networkidle",timeout:90000});
 const files=(await readdir(join(fixture,"dicom"))).sort().map(name=>join(fixture,"dicom",name));
 assert.equal(files.length,32);
 const chooser=page.locator('input[accept*=".dcm"]');
 await chooser.setInputFiles(files);
 try{
  await page.getByText(/Проиндексировано 32 DICOM/).waitFor({timeout:15000});
 }catch{
  // Next development hydration can complete after the SSR file input is visible.
  // The first unhydrated onchange event is not delivered to React.
  await chooser.setInputFiles([]);
  await chooser.setInputFiles(files);
  await page.getByText(/Проиндексировано 32 DICOM/).waitFor({timeout:45000});
 }
 await page.locator(".cs-series-list button").first().click();
 const analysis=page.locator('section[aria-label="Единый анализ DICOM"]');
 await analysis.waitFor();
 assert.match(await analysis.innerText(),/Грудная клетка/);
 assert.doesNotMatch(await analysis.innerText(),/Нет совместимого исполнительного пути/);
 await analysis.getByText("Настройки приватного исполнителя и разрешение",{exact:true}).click();
 await analysis.getByRole("checkbox",{name:/Подтверждаю разрешённый публичный/}).check();
 const launch=analysis.getByRole("button",{name:"Анализировать исследование"});
 await page.waitForFunction(()=>{const section=document.querySelector('section[aria-label="Единый анализ DICOM"]');
  const button=[...(section?.querySelectorAll("button")??[])].find(x=>x.textContent?.trim()==="Анализировать исследование");
  return !!button&&!button.disabled;},null,{timeout:60000});
 assert.equal(aiRequests.length,0,"No cloud request from indexing, worker probing, or authorization");
 await launch.click();
 await analysis.getByText(/Патологические модели грудной клетки недоступны/).waitFor({timeout:30000});
 await page.getByRole("heading",{name:/Gemini Orchestra · подготовка кадров/}).waitFor({timeout:30000});
 await page.getByText(/Первый шаг главного маршрута DICOM завершён/).waitFor();
 const visionImages=page.locator("img.ora-vision-plan-thumbnail");
 await visionImages.first().waitFor({timeout:60000});
 await page.waitForFunction(()=>document.querySelectorAll("img.ora-vision-plan-thumbnail").length===4,null,{timeout:60000});
 assert.equal(await visionImages.count(),4,"Four exact sampled DICOM previews");
 assert.equal(aiRequests.length,0,"Vision planning must not send any pixels");
 console.log("PASS browser: synthetic CT DICOM -> automatic worker absence -> independent four PNG Vision frames");
 const privacy=page.locator('section[aria-label="Подготовка обезличенных кадров"]');
 await privacy.waitFor();
 await privacy.getByText(/Проверьте все 4 исходящих PNG/).waitFor({timeout:180000});
 await page.waitForFunction(()=>{const s=document.querySelector('section[aria-label="Подготовка обезличенных кадров"]');
  return [...(s?.querySelectorAll("button")??[])].filter(b=>b.textContent?.includes("OCR 0 областей")).length===4;},null,{timeout:150000});
 assert.equal(aiRequests.length,0,"OCR must finish locally without cloud access");
 const cloud=page.locator('section[aria-label="Отправка проверенных обезличенных CT/MR кадров в OpenRouter"]');
 const send=cloud.getByRole("button",{name:"Подтвердить передачу и создать предварительное заключение"});
 assert.equal(await send.isDisabled(),true);
 const bulk=privacy.getByRole("checkbox",{name:/Я просмотрел ВСЕ показанные PNG/});
 await bulk.check();
 assert.equal(await bulk.isChecked(),true);
 await cloud.getByRole("textbox",{name:"Локальный пароль оператора"}).fill(operatorToken);
 await cloud.getByRole("checkbox",{name:/Я проверил все исходящие PNG/}).check();
 assert.equal(await send.isDisabled(),false);
 await send.click();
 await cloud.getByText(/Ответ моделей получен/).waitFor({timeout:180000});
 assert.ok(paidResult,"Real cloud POST response missing");
 assert.equal(paidResult.status,200,"Server returned error instead of live model results");
 assert.equal(paidResult.body?.schema,"opus-sanitized-cloud-pilot/v1");
 assert.equal(paidResult.body.results.length,2);
 assert.deepEqual(paidResult.body.results.map(r=>r.model),
  ["google/gemini-3.8-flash","anthropic/claude-opus-5.5"]);
 assert.deepEqual(paidResult.body.results.map(r=>r.reviewer),["gemini","opus"]);
 assert.deepEqual(paidResult.body.sourceFrames.map(f=>f.imageId),
  ["frame-1","frame-2","frame-3","frame-4"]);

 assert.equal(postCount,1,"Exactly one consent-gated real server request");
 const responses=await cloud.innerText();
 assert.match(responses,/Gemini Vision/);assert.match(responses,/Opus Vision/);
 await cloud.getByRole("button",{name:"Открыть исходный DICOM-срез"}).first().click();
 const checkButtons=cloud.getByRole("button",{name:"На перепроверку"});
 if(await checkButtons.count())await checkButtons.first().click();
 await cloud.getByRole("textbox",{name:/Рабочий синтез врача/}).fill("SYNTHETIC physician review — no diagnosis.");
 const downloadPromise=page.waitForEvent("download");
 await cloud.getByRole("button",{name:/Скачать локальный неподписанный протокол сверки JSON/}).click();
 const download=await downloadPromise;
 assert.match(download.suggestedFilename(),/opus-local-gemini-opus-physician-review\.json/);
 const dest=join(fixture,"doctor-review.json");
 await download.saveAs(dest);
 const exported=JSON.parse(await readFile(dest,"utf8"));
 const sanitized=JSON.stringify(exported);
 assert.match(sanitized,/SYNTHETIC physician review/);
 assert.doesNotMatch(sanitized,/2\.25\.1043521000002|SOPInstanceUID|StudyInstanceUID/);
 assert.equal(errors.length,0,"Browser console errors: "+errors.join(" / "));
 console.log("PASS LIVE E2E: 32 synthetic CT DICOM -> local PNG/OCR -> clinician authorization -> LIVE Gemini -> LIVE Opus -> original-slice navigation -> editable physician JSON");
 console.log(JSON.stringify({realOpenRouterCalls:2,sourceFrames:paidResult.body.sourceFrames.length,
  modelObservations:paidResult.body.results.map(r=>({model:r.model,reviewer:r.reviewer,
    count:r.review.observations.length})),noPatientData:true,
  authenticPathologyCheckpointInference:false}));
}catch(e){
 if(page)await page.screenshot({path:join(results,"live-openrouter-dicom-e2e-failure.png"),fullPage:true}).catch(()=>{});
 console.error("FAIL live OpenRouter synthetic DICOM E2E:",e instanceof Error?e.message:"Unknown error");
 console.error("Server tail:",logs.slice(-2000));
 process.exitCode=1;
}finally{
 await browser?.close().catch(()=>{});
 server.kill("SIGTERM");
 await rm(fixture,{recursive:true,force:true}).catch(()=>{});
}
