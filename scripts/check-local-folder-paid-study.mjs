/** Real browser DICOM/OCR -> existing signed API -> real paid providers.
 * Exact prepared copies must be inspected before the stdin confirmation.
 * No secrets read; source DICOM and full responses stay outside git.
 */
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {join,resolve} from 'node:path';
import {chromium} from '../web/node_modules/playwright/index.mjs';
const [sourceArg,outputArg,flag]=process.argv.slice(2);
assert.equal(flag,'--real-paid-reviewed-ten-slices');
assert.ok(process.stdin.isTTY,'Interactive terminal required for exact-copy visual review; no provider call without confirmation.');
const source=resolve(sourceArg??''),output=resolve(outputArg??'');
assert.ok(output.startsWith('/tmp/')||output.startsWith('/private/tmp/'));
const citation=await readFile(join(source,'CITATION.txt'),'utf8');
assert.ok(citation.includes('NLST')&&citation.includes('CC BY 4.0'));
await mkdir(output,{mode:0o700}); // New output directory required: no accidental repeat billing.
const files=(await readdir(source)).filter(f=>/\.dcm$/i.test(f)).sort().map(f=>join(source,f));
assert.equal(files.length,150);
let page;
const browser=await chromium.launch({headless:true,executablePath:process.env.OPUS_BROWSER_EXECUTABLE??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
try{
 page=await browser.newPage({viewport:{width:1400,height:1000}});page.setDefaultTimeout(180000);
 let approved=false,posts=0;const responses=[],pending=[];
 await page.route('**/api/ai/**',route=>{
  if(route.request().method()==='POST'){
   assert.ok(approved,'No unreviewed AI uploads');posts++;
   assert.ok(posts<=11,'At most ten bounded Gemini groups and one Opus final route; no automatic paid retries');
  }
  return route.continue(); // REAL server handlers, REAL providers, no mock replies.
 });
 page.on('response',response=>{
  if(response.request().method()!=='POST'||!response.url().includes('/api/ai/'))return;
  const task=(async()=>{
   const path=new URL(response.url()).pathname,data=await response.json();
   const record={path,status:response.status(),data};responses.push(record);
   await writeFile(join(output,'response-'+responses.length+'.json'),JSON.stringify(record,null,2),{mode:0o600});
   console.log(JSON.stringify({stage:'actual-api-response',path,status:response.status(),receipt:data.receipt??null,visualStatus:data.visualReview?.status??null}));
  })();pending.push(task);
 });
 console.log(JSON.stringify({stage:'opening-local-viewer'}));
 await page.goto('http://localhost:3000/viewer');
 await page.waitForFunction(()=>{const i=document.querySelector('input[accept*=".dcm"]');return i&&!i.disabled;});
 await page.locator('input[accept*=".dcm"]').setInputFiles(files);
 console.log(JSON.stringify({stage:'folder-loaded',frames:files.length}));
 await page.getByRole('button',{name:'Анализировать исследование',exact:true}).click();
 console.log(JSON.stringify({stage:'analysis-panel-opening'}));
 const full=page.getByRole('region',{name:'Последовательный анализ выбранной серии',exact:true});await full.waitFor();
 await full.getByRole('combobox',{name:'Какие срезы анализировать',exact:true}).selectOption('custom');
 await full.getByRole('textbox',{name:'Номера срезов',exact:true}).fill('60-69');
 await full.getByText('Настройки изображения, перепроверки и расходов',{exact:true}).click();
 await full.getByRole('combobox',{name:'Как показывать ткани на копиях для ИИ',exact:true}).selectOption('LUNG');
 await full.getByRole('combobox',{name:'Второй вид того же среза',exact:true}).selectOption('SOFT');
 await full.getByRole('button',{name:'Подготовить выбранные срезы к анализу',exact:true}).click();
 console.log(JSON.stringify({stage:'local-preparation-started'}));
 const review=full.getByRole('region',{name:'Проверка всей серии перед отправкой',exact:true});
 const preparationStart=Date.now();
 while(!await review.getByRole('checkbox',{name:/Я просмотрел выбранные подготовленные копии/}).isVisible()){
  if(await review.getByRole('alert').count())throw Error('Local preparation: '+await review.getByRole('alert').first().innerText());
  if(Date.now()-preparationStart>360000)throw Error('Local preparation exceeded six minutes');
  console.log(JSON.stringify({stage:'local-preparation-progress',message:await review.getByRole('status').first().innerText()}));
  await new Promise(r=>setTimeout(r,10000));
 }
 const copies=[];
 for(let group=0;group<3;group++){
  await review.getByRole('slider',{name:'Группа срезов для просмотра',exact:true}).fill(String(group));
  await page.waitForFunction(({group})=>{const figs=[...document.querySelectorAll('section[aria-label="Проверка всей серии перед отправкой"] figure')];return figs.length===(group===2?2:4)&&figs[0].textContent.includes(''+(60+group*4));},{group});
  const imgs=await review.locator('figure img').evaluateAll(nodes=>nodes.map(n=>n.src));
  for(let i=0;i<imgs.length;i++){
   const bytes=Buffer.from(imgs[i].split(',')[1],'base64'),slice=60+group*4+i;
   await writeFile(join(output,'review-slice-'+slice+'.png'),bytes,{mode:0o600});
   copies.push({slice,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
 }
 assert.equal(copies.length,10);assert.equal(posts,0);
 await writeFile(join(output,'prepared-copy-hashes.json'),JSON.stringify(copies,null,2),{mode:0o600});
 console.log(JSON.stringify({stage:'awaiting-exact-png-visual-review',sourceFrames:150,selectedSlices:'60–69',copies:10,apiPosts:posts,output}));
 const rl=createInterface({input:process.stdin});let confirmed=false;
 for await(const line of rl){assert.equal(line.trim(),'REVIEWED_TEN_EXACT_PNGS');confirmed=true;break;}rl.close();assert.ok(confirmed);
 await writeFile(join(output,'visual-review.json'),JSON.stringify({reviewer:'Assistant exact PNG visual inspection, not physician signature',confirmedAt:new Date().toISOString(),copies}),{mode:0o600});
 approved=true;const began=Date.now();
 await review.getByRole('checkbox',{name:/Я просмотрел выбранные подготовленные копии/}).check();
 await review.getByRole('button',{name:'Отправить всю проверенную серию в анализ',exact:true}).click();
 const inferenceStart=Date.now();
 while(!await full.getByRole('textbox',{name:/Предварительное заключение/}).isVisible()){
  if(await full.getByRole('button',{name:'Восстановить подключение',exact:true}).isVisible())throw Error('Workstation connection unavailable');
  if(await full.getByRole('button',{name:'Получить заключение',exact:true}).isVisible()||await full.getByRole('button',{name:'Вернуться к выбору срезов',exact:true}).isVisible())throw Error('Inference interrupted: '+await full.innerText());
  if(Date.now()-inferenceStart>600000)throw Error('Inference timed out');
  await new Promise(r=>setTimeout(r,2000));
 }
 await Promise.all(pending);
 const report=await full.getByRole('textbox',{name:/Предварительное заключение/}).inputValue();
 await writeFile(join(output,'actual-provisional-report-ru.txt'),report,{mode:0o600});
 const gemini=responses.filter(r=>r.path.includes('gemini')),opus=responses.find(r=>r.path.includes('complete-volume-opus'));
 const result={realBrowserDicom:true,actualPaidProviderCalls:true,responsesMocked:false,sourceFrames:150,selectedOriginalSlices:copies.map(c=>c.slice),
  confirmedGeminiFrames:gemini.filter(r=>r.status===200).reduce((n,r)=>n+r.data.imagesReviewed,0),geminiStatuses:gemini.map(r=>r.status),opusStatus:opus?.status??null,
  opusVisualStatus:opus?.data.visualReview?.status??'not-requested',opusVisualSlices:opus?.data.visualReview?.sliceNumbers??[],reportCharacters:report.length,elapsedSeconds:(Date.now()-began)/1000,
  independentClinicalAccuracyValidated:false,reportFile:'actual-provisional-report-ru.txt'};
 await writeFile(join(output,'result.json'),JSON.stringify(result,null,2),{mode:0o600});
 console.log(JSON.stringify(result));
 assert.equal(result.confirmedGeminiFrames,10,'A partial report is preserved but does not pass ten-frame acceptance');
 assert.equal(result.opusStatus,200);
}catch(e){if(page)await writeFile(join(output,'failure-ui.txt'),await page.locator('body').innerText().catch(()=>''),{mode:0o600});console.error('Real run stopped:',e.message);process.exitCode=1;}finally{await browser.close();}
