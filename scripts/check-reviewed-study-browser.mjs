/** Local dev acceptance with generated nonpatient pixels. No paid requests. */
import assert from "node:assert/strict";
import {mkdtemp,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {chromium} from "../web/node_modules/playwright/index.mjs";
const root=fileURLToPath(new URL("../",import.meta.url));
const base=process.env.OPUS_TEST_BASE_URL??"http://localhost:3000";
assert.match(base,/^http:\/\/(localhost|127\.0\.0\.1):[0-9]+$/);
const fixture=await mkdtemp(join(tmpdir(),"opus-reviewed-study-"));
execFileSync(process.execPath,[join(root,"scripts/generate-segmentation-phantom.mjs"),
 fixture,"CT","rescale-hu","CHEST"],{stdio:"pipe"});
const browser=await chromium.launch({headless:true,
 ...(process.env.OPUS_BROWSER_EXECUTABLE?{executablePath:process.env.OPUS_BROWSER_EXECUTABLE}:{}),
});
try{
 const page=await browser.newPage();
 const paid=[];let connectionChecks=0,connectionOffline=false;
 await page.route("**/api/ai/**",async route=>{
  if(route.request().method()==="POST"){
   paid.push(new URL(route.request().url()).pathname);
   return route.abort();
  }
  if(new URL(route.request().url()).pathname==="/api/ai/deidentified-openrouter-review"){
   connectionChecks++;
   if(connectionOffline)return route.fulfill({status:503,contentType:"application/json",body:"{}"});
  }
  return route.continue();
 });
 await page.goto(base+"/viewer");
 await page.locator('input[accept*=".dcm"]').setInputFiles(
  (await readdir(join(fixture,"dicom"))).sort().map(n=>join(fixture,"dicom",n)));
 const analyze=page.getByRole("button",{name:"Анализировать исследование",exact:true});
 await analyze.waitFor({timeout:60_000});
 assert.equal(connectionChecks,0,"Opening a study without Analyze does not connect cloud sessions");
 await analyze.click({timeout:45_000});
 assert.equal(await page.getByRole("region",{name:"Автоматический анализ всего исследования",exact:true}).count(),0);
 await page.getByText("Локальное рабочее место подключено.",{exact:false}).waitFor({timeout:60_000});
 assert.ok(connectionChecks>0,"Analyze connects the preapproved local workstation without a second click");
 const send=page.getByRole("button",{name:"Запустить анализ и получить заключение",exact:true});
 assert.equal(await send.isDisabled(),true,"No inference without privacy review and transfer consent");
 assert.deepEqual(paid,[],"Opening, analyzing and connecting must not send unreviewed pixels");
 console.log("PASS: primary Analyze connects automatically without another click or token; opening files does not connect; unreviewed upload blocked (synthetic only)");
 // Synthetic readiness followed by an explicit failure tests physician-facing
 // routing/status without pretending to produce trained model findings.
 let modelUploads=0;
 await page.route("**/api/local-nodule/v1/nodule/capabilities",route=>route.fulfill({
  contentType:"application/json",body:JSON.stringify({
   schema:"opus-monai-live-worker/v1",modelId:"monai-lung-nodule-ct-retinanet",modelVersion:"0.6.9",
   checkpointSha256:"b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01",
   modelRevision:"7226a40a4c3713f7d5469559b7f2fc296fd54825",originalWeightsVerified:true,
   mode:"local",dataPolicy:"approved-public-reference-only",sourceFormat:"original-nifti-uncompressed",
   patientMode:false,imageUpload:true,ready:true,unvalidatedResearch:true,
   automaticExecution:{location:"private",attempts:[{location:"private",status:"ready"}]},
  }),
 }));
 await page.route("**/api/local-nodule/v1/nodule/upload",route=>{
  modelUploads++;
  return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"synthetic test: no inference"})});
 });
 connectionOffline=true;
 await page.reload();
 await page.locator('input[accept*=".dcm"]').setInputFiles(
  (await readdir(join(fixture,"dicom"))).sort().map(n=>join(fixture,"dicom",n)));
 const task=page.getByRole("status",{name:"Автоматический исполнитель для узлов лёгких"});
 await task.filter({hasText:"выбран подключённый приватный сервер"}).waitFor({timeout:45_000});
 await analyze.click({timeout:45_000});
 await task.filter({hasText:"детектор завершился с ошибкой"}).waitFor({timeout:60_000});
 await page.getByText("Не удалось проверить подключение Gemini и Opus.",{exact:false}).waitFor({timeout:60_000});
 connectionOffline=false;
 await page.getByRole("button",{name:"Повторить проверку подключения",exact:true}).click();
 await page.getByText("Локальное рабочее место подключено.",{exact:false}).waitFor();
 assert.equal(modelUploads,1,"A detector failure must not silently duplicate inference");
 assert.deepEqual(paid,[]);
 console.log("PASS: unavailable connection retries without repeating the detector or sending pixels; private MONAI failure remains explicitly not assessed (synthetic only)");
}finally{await browser.close();}
