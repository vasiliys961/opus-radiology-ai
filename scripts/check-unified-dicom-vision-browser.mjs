/** End-to-end UI test using genuine synthetic DICOM bytes; no patient data or paid AI calls. */
import {createRequire} from "node:module";
import {spawn,execFileSync} from "node:child_process";
import {mkdtemp,readdir,readFile,rm,mkdir} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
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
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start",
 "--hostname","127.0.0.1","--port",String(port)],{cwd:join(root,"web"),stdio:["ignore","pipe","pipe"]});
let logs="";server.stdout.on("data",b=>logs+=String(b).slice(-3000));
server.stderr.on("data",b=>logs+=String(b).slice(-3000));
let browser,page;
try{
 for(let i=0;i<120;i++){
  try{const r=await fetch(baseUrl+"/viewer");if(r.ok)break;}catch{}
  if(i===119)throw Error("Next server did not start: "+logs.slice(-1500));
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 browser=await chromium.launch({headless:true,args:["--no-sandbox",
  "--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
 const context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});
 page=await context.newPage();const errors=[];const aiRequests=[];
 page.on("pageerror",e=>errors.push(e.message));
 page.on("request",r=>{if(new URL(r.url()).pathname==="/api/ai/deidentified-openrouter-review")
  aiRequests.push(r.method());});
 await page.goto(baseUrl+"/viewer",{waitUntil:"domcontentloaded",timeout:45000});
 const files=(await readdir(join(fixture,"dicom"))).sort().map(name=>join(fixture,"dicom",name));
 assert.equal(files.length,32);
 await page.locator('input[accept*=".dcm"]').setInputFiles(files);
 await page.getByText(/Проиндексировано 32 DICOM/).waitFor({timeout:45000});
 await page.locator(".cs-series-list button").first().click();
 const analysis=page.locator('section[aria-label="Единый анализ DICOM"]');
 await analysis.waitFor();
 assert.match(await analysis.innerText(),/Грудная клетка/);
 assert.doesNotMatch(await analysis.innerText(),/Нет совместимого исполнительного пути/);
 await analysis.getByText("Настройки приватного исполнителя и разрешение",{exact:true}).click();
 await analysis.getByRole("checkbox",{name:/Подтверждаю, что исследование разрешено/}).check();
 const launch=analysis.getByRole("button",{name:"Анализировать исследование"});
 await page.waitForFunction(()=>{const section=document.querySelector('section[aria-label="Единый анализ DICOM"]');
  const button=[...(section?.querySelectorAll("button")??[])].find(x=>x.textContent?.trim()==="Анализировать исследование");
  return !!button&&!button.disabled;},null,{timeout:60000});
 assert.equal(aiRequests.length,0,"No cloud request from indexing, worker probing, or authorization");
 await launch.click();
 // The SAME primary action must open offline Vision planning immediately.
 // The heavy original worker path is independent and may still be running.
  await page.getByText("Дополнительно · анализ отдельных срезов",{exact:true}).click();
  await page.getByRole("heading",{name:/Gemini Orchestra · подготовка кадров/}).waitFor({timeout:30000});
 await page.getByText(/Основной анализ DICOM запущен/).waitFor({timeout:30000});
 assert.equal(await page.getByRole("button",{name:"Запустить единый анализ КТ/МРТ"}).count(),0,
  "Only one physician Analyze action; duplicate research launch must be hidden");
 assert.equal(await analysis.getByRole("button",{name:"Анализировать исследование"}).count(),1);

 await analysis.getByText(/Патологические модели грудной клетки недоступны/).waitFor({timeout:30000});
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
 const mockedLongProtocol="ИССЛЕДОВАНИЕ:\nСинтетическая учебная КТ, отдельные кадры.\n"+
  "МЕТОДИКА:\nОценены выборочные кадры, полный ряд недоступен.\n"+
  "ОПИСАНИЕ:\n"+("Учебное описание синтетического изображения, без клинической интерпретации.\n").repeat(90)+
  "ЗАКЛЮЧЕНИЕ:\nКлинических выводов по фантому нет.\n"+
  "РЕКОМЕНДАЦИИ:\nТолько программная проверка.";
 assert.ok(mockedLongProtocol.length>6000&&mockedLongProtocol.length<12000);
 let posted=null,postCount=0;
 await page.route("**/api/ai/deidentified-openrouter-review",async route=>{
  const req=route.request();
  if(req.method()==="GET")return route.fulfill({status:200,contentType:"application/json",
   body:JSON.stringify({schema:"opus-deidentified-openrouter-pilot-readiness/v1",
    enabled:true,provider:"openrouter",productionPatientCloudRelease:false})});
  assert.equal(req.method(),"POST");
  postCount++;posted=req.postDataJSON();const packet=posted.packet;
  assert.equal(posted.acknowledgeClinicianLawfulDisclosure,true);
  assert.equal(posted.acknowledgeProviderHealthDataTerms,true);
  assert.equal(posted.acknowledgePixelIdentityReviewed,true);
  assert.equal(posted.acknowledgeTwoPaidCalls,true);
  assert.equal(packet.frames.length,4);
  for(const f of packet.frames){
   assert.equal(f.modality,"CT");assert.match(f.pngBase64,/^[A-Za-z0-9+/]+=*$/);
   assert.match(f.sha256,/^[0-9a-f]{64}$/);
  }
  const safe=JSON.stringify(packet);
  for(const forbidden of ["SOPInstanceUID","StudyInstanceUID","PatientName","2.25.1043521000002",
    "SYNTHETIC PHANTOM - NOT PATIENT DATA"])assert.ok(!safe.includes(forbidden),"Leak: "+forbidden);
  const frames=packet.frames.map(f=>({imageId:f.frameId,reviewedPixelSha256:f.sha256}));
  const role=reviewer=>({reviewer,model:reviewer==="gemini"?"google/gemini-3.8-flash":"anthropic/claude-opus-5.5",
   review:{role:"observations",reviewedImageIds:frames.map(f=>f.imageId),observations:[
    {id:reviewer+"-one",imageId:"frame-1",anatomy:"synthetic phantom",
     sign:"nonclinical synthetic image",uncertainty:"This is an artificial fixture."}],
    limitations:["Only four synthetic 2-D frames were inspected."]}});
  const response={schema:"opus-sanitized-cloud-pilot/v1",modality:"CT",
   coverage:"sampled-frames-only",results:[role("gemini"),role("opus")],
   sourceFrames:frames,callsAttempted:2,originalDicomSent:false,
   sourceDicomIdentifiersSent:false,clinicalReviewRequired:true,
   deidentificationIndependentlyCertified:false,patientDataCanStillBeSensitive:true,
   researchOnly:true,diagnosticAccuracyValidated:false,
   opusSynthesis:{
    schema:"opus-integrated-gemini-detector-synthesis/v1",
    summary:mockedLongProtocol,
    comparisons:[],conflicts:[],
    limitations:["Синтетический фантом; не отражает реальных пациентов."],
    sourceCoverage:"sampled_frames_only",clinicallyValidated:false,
   }};
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(response)});
 });
 await cloud.getByRole("textbox",{name:"Локальный пароль оператора"}).fill("test-operator-token-0123456789");
 await cloud.getByRole("checkbox",{name:/Я проверил все исходящие PNG/}).check();
 assert.equal(await send.isDisabled(),false);
 await send.click();
 await cloud.getByText(/Ответ моделей получен/).waitFor({timeout:30000});
 assert.equal(postCount,1,"Exactly one consent-gated two-model server request");
 const responses=await cloud.innerText();
 assert.match(responses,/Gemini Vision/);assert.match(responses,/Opus Vision/);
 const integrated=cloud.locator('section[aria-label="Объединённое заключение Opus по Gemini JSON и детекторам"]');
 await integrated.waitFor();
 const reportField=integrated.getByRole("textbox",{name:"Редактируемое описание и заключение рентгенолога"});
 assert.equal(await reportField.inputValue(),mockedLongProtocol,
   "The entire >6000-character response must be visible in the physician editor");
 const physicianRevision=mockedLongProtocol+"\nSYNTHETIC OPUS INTEGRATED REPORT after Gemini JSON.";
 await integrated.getByRole("textbox",{name:"Редактируемое описание и заключение рентгенолога"})
   .fill(physicianRevision);
 assert.equal(await reportField.inputValue(),physicianRevision,"Long clinician edits cannot truncate");

 const reportDownloadPromise=page.waitForEvent("download");
 await integrated.getByRole("button",{name:"Скачать заключение рентгенолога TXT"}).click();
 const reportDownload=await reportDownloadPromise;
 assert.equal(reportDownload.suggestedFilename(),"opus-preliminary-radiologist-report.txt");
 const txt=join(fixture,"radiologist-report.txt");
 await reportDownload.saveAs(txt);
 assert.equal(await readFile(txt,"utf8"),physicianRevision+"\n","TXT must preserve all characters");
 await cloud.getByRole("button",{name:"Показать исходный срез"}).first().click();
 await cloud.getByRole("button",{name:"На перепроверку"}).first().click();
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
 assert.match(sanitized,/SYNTHETIC OPUS INTEGRATED REPORT/);
 assert.deepEqual(exported.integratedOpusReport.comparisons,[]);
 assert.equal(exported.integratedOpusReport.clinicallyValidated,false);
 assert.doesNotMatch(sanitized,/2\.25\.1043521000002|SOPInstanceUID|StudyInstanceUID/);
 assert.equal(errors.length,0,"Browser console errors: "+errors.join(" / "));
 console.log("PASS UI: local OCR -> physician review -> authorized mock Gemini/Opus -> source slice -> physician JSON");
 console.log("MOCKED REMOTE API: no paid/provider calls or real detector checkpoint inference performed");
}catch(e){
 if(page)await page.screenshot({path:join(results,"unified-dicom-vision-e2e-failure.png"),fullPage:true}).catch(()=>{});
 console.error("FAIL unified DICOM Vision E2E:",e);
 console.error("Server tail:",logs.slice(-2000));
 process.exitCode=1;
}finally{
 await browser?.close().catch(()=>{});
 server.kill("SIGTERM");
 await rm(fixture,{recursive:true,force:true}).catch(()=>{});
}
