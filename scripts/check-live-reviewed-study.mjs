/** Actual local UI + permitted public TCIA frames + paid Gemini/Opus.
 * Opt-in only; no secrets read here, no mock model responses or diagnostic metrics.
 * Exact outgoing PNGs must be visually inspected before the stdin review token.
 */
import assert from "node:assert/strict";
import {readFile,readdir,mkdir,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {join,resolve} from "node:path";
import {createInterface} from "node:readline";
import {chromium} from "../web/node_modules/playwright/index.mjs";
import {stripPngMetadata} from "../web/lib/vision-privacy.ts";
const [source,output,approval]=process.argv.slice(2);
assert.equal(approval,"--two-paid-public-frame-calls","Explicit two-call opt-in required");
assert.ok(source&&output);
const folder=resolve(source),destination=resolve(output);
assert.ok(destination.startsWith("/tmp/")||destination.startsWith("/private/tmp/"));
const manifest=JSON.parse(await readFile(join(folder,"reference.json"),"utf8"));
assert.equal(manifest.collection,"TCIA LCTSC");assert.equal(manifest.license,"CC BY 3.0");
assert.equal(manifest.sourceContentChainSha256,"bb4b90496cf2d83dac83e729ef271091962d532a18db201c6e2d99d42dcb5f61");
const files=(await readdir(join(folder,"dicom"))).sort().map(n=>join(folder,"dicom",n));
assert.equal(files.length,manifest.selectedFrames);
for(let i=0;i<files.length;i++)assert.equal(createHash("sha256").update(await readFile(files[i])).digest("hex"),manifest.selectedFileSha256[i]);
await mkdir(destination,{mode:0o700}); // fail rather than accidentally repeat paid acceptance
const browser=await chromium.launch({headless:true,
 ...(process.env.OPUS_BROWSER_EXECUTABLE?{executablePath:process.env.OPUS_BROWSER_EXECUTABLE}:{}),
});
let page;
try{
 page=await browser.newPage({viewport:{width:1400,height:1000}});
 let posts=0;const apiStatuses=[];
 page.on("request",r=>{if(r.method()==="POST"&&r.url().includes("/api/ai/"))posts++;});
 page.on("response",r=>{if(r.request().method()==="POST"&&r.url().includes("/api/ai/"))apiStatuses.push(r.status());});
 await page.goto("http://localhost:3000/viewer?research=1");
 await page.waitForFunction(()=>{
  const input=document.querySelector('input[accept*=".dcm"]');return input&&!input.disabled;
 });
 await page.locator('input[accept*=".dcm"]').setInputFiles(files);
 console.log(JSON.stringify({stage:"source-files-selected",sourceFrames:files.length}));
 await page.getByRole('checkbox',{name:/Подтверждаю правомерность исследовательской обработки/}).check();
 await page.getByRole("button",{name:"Анализировать исследование",exact:true}).click({timeout:90_000});
 console.log(JSON.stringify({stage:"analysis-started",sourceFrames:files.length}));
 await page.getByText('Дополнительно · анализ отдельных срезов',{exact:true}).click();
 const copies=page.getByRole("region",{name:"Все исходящие обезличенные копии",exact:true});
 await copies.waitFor({timeout:180_000});
 const review=copies.getByRole("checkbox",{name:/Я просмотрел все кадры/});
 const images=await copies.locator("img").evaluateAll(nodes=>nodes.map(n=>n.src));
 const previews=await page.locator("img.ora-vision-plan-thumbnail").evaluateAll(nodes=>nodes.map(n=>n.src));
 assert.equal(images.length,4);
 for(let i=0;i<images.length;i++){
  assert.ok(images[i].startsWith("data:image/png;base64,"));
  assert.deepEqual(Buffer.from(images[i].split(",")[1],"base64"),
   Buffer.from(stripPngMetadata(Buffer.from(previews[i].split(",")[1],"base64")).bytes),
   "Unreviewed OCR may not erase diagnostic pixels");
  await writeFile(join(destination,"review-frame-"+(i+1)+".png"),Buffer.from(images[i].split(",")[1],"base64"),{mode:0o600});
 }
 assert.equal(posts,0,"No image upload before exact-copy visual review");
 console.log(JSON.stringify({stage:"awaiting-local-visual-review",outgoingCopies:4,sourceFrames:files.length,paidRequests:posts,imagesDirectory:destination}));
 const rl=createInterface({input:process.stdin});
 let confirmed=false;
 for await(const line of rl){if(line.trim()==="REVIEWED_FOUR_PUBLIC_PNGS"){confirmed=true;break;}throw Error("Exact visual review not confirmed");}
 rl.close();assert.equal(confirmed,true);
 // All exact copies and their marked areas were visually inspected above.
 await review.check();
 const cloud=page.getByRole("region",{name:"Отправка проверенных обезличенных CT/MR кадров в OpenRouter",exact:true});
 await cloud.getByText("Локальное рабочее место подключено.",{exact:false}).waitFor({timeout:15_000});
 await cloud.getByRole("checkbox",{name:/Разрешаю передать проверенные обезличенные кадры/}).check();
 const send=cloud.getByRole("button",{name:"Запустить анализ и получить заключение",exact:true});
 assert.equal(await send.isDisabled(),false);
 const began=Date.now();await send.click();
 await Promise.race([
  cloud.getByText("Ответ моделей получен.",{exact:false}).waitFor({timeout:150_000}),
  cloud.getByRole("alert").waitFor({timeout:150_000}).then(async()=>{throw Error("Actual app review failed: "+await cloud.getByRole("alert").innerText());}),
 ]);
 const report=cloud.getByRole("textbox",{name:"Редактируемое описание и заключение рентгенолога",exact:true});
 const text=await report.inputValue();assert.ok(text.length>=180);
 assert.equal(await report.isEditable(),true);
 await writeFile(join(destination,"actual-preliminary-report.txt"),text,{mode:0o600});
 const download=page.waitForEvent("download");
 await cloud.getByRole("button",{name:"Скачать заключение рентгенолога TXT",exact:true}).click();
 await (await download).saveAs(join(destination,"downloaded-report.txt"));
 assert.equal(await readFile(join(destination,"downloaded-report.txt"),"utf8"),text.trim()+"\n");
 assert.equal(posts,1);assert.deepEqual(apiStatuses,[200]);
 const result={status:"passed",actualBrowserDICOM:true,publicSource:"TCIA LCTSC CC BY 3.0",
  sourceFrames:files.length,reviewedFrames:4,diagnosticPixelsPreserved:true,actualPaidModelChain:true,apiRequests:posts,
  reportCharacters:text.length,reportEditable:true,txtDownloaded:true,elapsedSeconds:(Date.now()-began)/1000,
  authenticDetectorInference:false,clinicalAccuracyValidated:false,wholeStudyReviewed:false};
 await writeFile(join(destination,"technical-result.json"),JSON.stringify(result,null,2),{mode:0o600});
 console.log(JSON.stringify(result));
}catch(error){
 if(page){
  await page.screenshot({path:join(destination,"failure-screen.png"),fullPage:true}).catch(()=>{});
  await writeFile(join(destination,"failure-ui.txt"),await page.locator("body").innerText(),{mode:0o600}).catch(()=>{});
 }
 throw error;
}finally{await browser.close();}
