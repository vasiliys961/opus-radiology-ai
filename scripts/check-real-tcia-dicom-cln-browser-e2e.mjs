/** REAL, not mocked: unchanged TCIA scanner DICOM -> actual Chrome viewer button
 * -> original pretrained CLN CPU via live local worker -> authorized Gemini Vision
 * -> Claude Opus -> radiologist-standard Russian protocol downloaded from UI.
 */
import {createRequire} from "node:module";
import {readFileSync,readdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const require=createRequire(new URL("../web/package.json",import.meta.url));
const {chromium}=require("playwright");
const [reference,reportPath,operatorToken]=process.argv.slice(2);
if(!reference||!reportPath?.endsWith(".json")||!operatorToken||operatorToken.length<24)
 throw Error("original public TCIA source, local JSON report and operator token required");
if(!process.env.OPENROUTER_API_KEY)throw Error("Two genuine provider calls required");
const manifest=JSON.parse(readFileSync(join(reference,"reference.json"),"utf8"));
assert.equal(manifest.selectedFrames,103);
assert.equal(manifest.allSourceFrames,true);
assert.equal(manifest.sourceContentChainSha256,
 "bb4b90496cf2d83dac83e729ef271091962d532a18db201c6e2d99d42dcb5f61");
const files=readdirSync(join(reference,"dicom")).filter(n=>/^reference-\d{3}\.dcm$/.test(n))
 .sort().map(n=>join(reference,"dicom",n));
assert.equal(files.length,103);
const browser=await chromium.launch({headless:true,args:["--no-sandbox",
 "--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const ctx=await browser.newContext({viewport:{width:1600,height:980},acceptDownloads:true});
const page=await ctx.newPage();
const errors=[],posts=[];
let modelUploadCount=0,providerPostCount=0;
let providerDocument=null;
page.on("pageerror",e=>errors.push(e.message));
page.on("request",r=>{
 const path=new URL(r.url()).pathname;
 if(r.method()==="POST"&&path==="/api/local-cln/v1/cln/upload")modelUploadCount++;
 if(r.method()==="POST"&&path==="/api/ai/deidentified-openrouter-review"){
  providerPostCount++;
  const request=r.postDataJSON();
  assert.equal(request.acknowledgeTwoPaidCalls,true);
  assert.equal(request.packet?.frames?.length,4);
  assert.equal(request.detectorEvidence?.facts?.find(f=>f.task==="lung_tumor")?.status,
   "completed","A *new* original CLN model must be sent to Opus");
 }
 posts.push({path,method:r.method()});
});
page.on("response",async r=>{
 if(new URL(r.url()).pathname==="/api/ai/deidentified-openrouter-review"&&
    r.request().method()==="POST"){
  if(r.ok())providerDocument=await r.json();
 }
});
try{
 await page.goto("http://127.0.0.1:3000/viewer",{waitUntil:"domcontentloaded",timeout:70000});
 await page.locator('input[accept*=".dcm"]').setInputFiles(files);
 await page.getByText(/Проиндексировано 103 DICOM/).waitFor({timeout:120000});
 await page.locator(".cs-series-list button").first().click();
 const study=page.locator('section[aria-label="Единый анализ DICOM"]');
 await study.waitFor({timeout:45000});
 const sourceConfirmation=study.getByRole("checkbox",{name:/Подтверждаю, что это КТ грудной клетки/});
 if(await sourceConfirmation.count())await sourceConfirmation.check();
 assert.match(await study.innerText(),/Грудная клетка/);
 await study.getByText("Настройки приватного исполнителя и разрешение",{exact:true}).click();
 await study.getByRole("checkbox",{name:/Подтверждаю разрешённый публичный/}).check();
 const run=study.getByRole("button",{name:"Анализировать исследование"});
 await page.waitForFunction(()=>{
  const section=document.querySelector('section[aria-label="Единый анализ DICOM"]');
  const button=[...(section?.querySelectorAll("button")??[])].find(x=>
    x.textContent?.trim()==="Анализировать исследование");
  return !!button&&!button.disabled;
 },null,{timeout:90000});
 await run.click();
 await page.getByRole("heading",{name:/Gemini Orchestra · подготовка кадров/})
  .waitFor({timeout:45000});
 // This is ACTUAL 3-D original CLN model execution. Allow bounded CPU time.
 const cln=page.locator('section[aria-label="CLN original lung-tumor physician review"]');
 await cln.waitFor({timeout:3_300_000});
 await cln.getByText(/Сверяем исходное исследование/).waitFor({state:"hidden",timeout:90000});
 assert.equal(modelUploadCount,1,"Exactly one genuine DICOM->CLN upload");
 const clnText=await cln.innerText();
 assert.match(clnText,/Оригинальный nnU-Net/);
 assert.doesNotMatch(clnText,/Переход к срезам заблокирован/);
 const images=page.locator("img.ora-vision-plan-thumbnail");
 await images.first().waitFor({timeout:180000});
 await page.waitForFunction(()=>
  document.querySelectorAll("img.ora-vision-plan-thumbnail").length===4,
  null,{timeout:120000});
 const privacy=page.locator('section[aria-label="Подготовка обезличенных кадров"]');
 await privacy.getByText(/Проверьте все 4 исходящих PNG/).waitFor({timeout:240000});
 await privacy.getByRole("checkbox",{name:/Я просмотрел ВСЕ показанные PNG/}).check();
 await page.waitForFunction(()=>{
  const root=document.querySelector('section[aria-label="Отправка проверенных обезличенных CT/MR кадров в OpenRouter"]');
  return !!root&&[...root.querySelectorAll("input")].some(x=>x.type==="password");
 },null,{timeout:45000});
 const cloud=page.locator('section[aria-label="Отправка проверенных обезличенных CT/MR кадров в OpenRouter"]');
 await cloud.getByRole("textbox",{name:"Локальный пароль оператора"}).fill(operatorToken);
 await cloud.getByRole("checkbox",{name:/Я проверил все исходящие PNG/}).check();
 const paid=cloud.getByRole("button",{name:"Подтвердить передачу и создать предварительное заключение"});
 assert.equal(await paid.isDisabled(),false);
 await paid.click();
 await cloud.getByText(/Ответ моделей получен/).waitFor({timeout:590000});
 await page.waitForFunction(()=>!!document.querySelector(
   'section[aria-label="Объединённое заключение Opus по Gemini JSON и детекторам"] textarea'),
   null,{timeout:45000});
 assert.equal(providerPostCount,1,"Exactly one authorized Gemini->Opus provider request");
 assert.equal(modelUploadCount,1,"Do not repeat CLN model inference");
 assert.ok(providerDocument?.opusSynthesis?.summary?.includes("ОПИСАНИЕ:"));
 assert.ok(providerDocument?.opusSynthesis?.summary?.includes("ЗАКЛЮЧЕНИЕ:"));
 const model=providerDocument.detectorEvidence.facts.find(f=>f.task==="lung_tumor");
 assert.equal(model.status,"completed");
 assert.equal(providerDocument.results[0].reviewer,"gemini");
 assert.equal(providerDocument.results[1].reviewer,"opus");
 const txt=reportPath.slice(0,-5)+".txt";
 const download=page.waitForEvent("download",{timeout:25000});
 await cloud.getByRole("button",{name:"Скачать заключение рентгенолога TXT"}).click();
 const receipt=await download;
 await receipt.saveAs(txt);
 const narrative=readFileSync(txt,"utf8");
 assert.equal(narrative.trim(),providerDocument.opusSynthesis.summary.trim());
 assert.ok(narrative.length>180&&narrative.includes("МЕТОДИКА:"));
 assert.ok(!/SOPInstanceUID|StudyInstanceUID|PatientName/.test(narrative));
 const receiptJson={
  schema:"opus-real-original-TCIA-DICOM-browser-CLN-Gemini-Opus/v1",
  originalTCIAReferenceSHA256Chain:manifest.sourceContentChainSha256,
  browserOriginalScannerDICOMFrames:103,
  originalCLNForwardRunFromViewer:true,
  actualBrowserCLNUploads:modelUploadCount,
  trueOriginalCLNCompletedTasks:providerDocument.detectorEvidence.facts,
  realGeminiAndOpusServerRequests:providerPostCount,
  reviewerModels:providerDocument.results.map(x=>({reviewer:x.reviewer,model:x.model})),
  originalDICOMOrSopUIDSentToProvider:false,
  sampledOriginalScannerDICOMFrames:4,
  receivedSourceBoundSpatialAnchors:providerDocument.frameRelativeClnEvidence?.candidateAnchors?.length??0,
  report:providerDocument.opusSynthesis.summary,
  clinicalValidation:false,physicianSigned:false,
 };
 writeFileSync(reportPath,JSON.stringify(receiptJson,null,2)+"\n",{flag:"wx",mode:0o600});
 assert.equal(errors.length,0,"Browser errors: "+errors.join(" | "));
 console.log("ACTUAL BROWSER FULL END-TO-END PASS",JSON.stringify({
  originalCTDICOMFiles:103,actualOriginalCLNUploads:1,
  candidateCount:model.candidateCount,realGeminiOpusProviderRequest:true,
  modelSpatialAnchors:receiptJson.receivedSourceBoundSpatialAnchors,
  fullRadiologistTextSaved:true,clinicalValidation:false
 }));
}catch(e){
 console.error("ACTUAL BROWSER REAL DICOM E2E FAILED",e);
 console.error("Requests summary",posts.filter(p=>p.method==="POST").map(p=>p.path));
 console.error("Browser errors",errors.slice(-5));
 process.exitCode=1;
}finally{await browser.close();}
