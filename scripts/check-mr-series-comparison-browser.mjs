/** Two synthetic MR series: local physical-plane comparison, zero cloud POSTs. */
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../web/node_modules/playwright/index.mjs';
const temp=await mkdtemp(join(tmpdir(),'opus-mr-compare-'));
execFileSync(process.execPath,['scripts/generate-segmentation-phantom.mjs',temp,'MR'],{stdio:'pipe'});
const companion=join(temp,'companion');await mkdir(companion);
const source=(await readdir(join(temp,'dicom'))).sort().slice(0,3);
const root='2.25.1043521000001';
for(const name of source){
 const bytes=await readFile(join(temp,'dicom',name));
 const text=bytes.toString('latin1').replaceAll(root+'.2',root+'.8').replaceAll(root+'.4.',root+'.7.');
 await writeFile(join(companion,name),Buffer.from(text,'latin1'));
}
const base=process.env.OPUS_TEST_BASE_URL??'http://localhost:3000';assert.match(base,/^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const browser=await chromium.launch({headless:true,...(process.env.OPUS_BROWSER_EXECUTABLE?{executablePath:process.env.OPUS_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});
try{
 const page=await browser.newPage();page.setDefaultTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));let cloudPosts=0;
 await page.route('**/api/ai/**',route=>{
  if(route.request().method()==='POST'){cloudPosts++;throw Error('Unexpected cloud POST from local MR comparison');}
  return route.fulfill({json:{enabled:true,workstationConnected:true}});
 });
 await page.goto(base+'/viewer');await page.waitForFunction(()=>!document.querySelector('input[accept*=".dcm"]')?.disabled);
 await page.locator('input[accept*=".dcm"]').setInputFiles([...source.map(n=>join(temp,'dicom',n)),...source.map(n=>join(companion,n))]);
 await page.getByRole('button',{name:'Анализировать исследование',exact:true}).click();
 const comparison=page.getByRole('region',{name:'Локальное сравнение МР-серий',exact:true});
 await comparison.getByRole('button',{name:'Сравнить МР-серии рядом'}).click();
 await comparison.getByRole('img',{name:'Основная МР-серия',exact:true}).waitFor();
 await comparison.getByRole('img',{name:'Сопоставляемая МР-серия',exact:true}).waitFor();
 assert.match(await comparison.innerText(),/0.00 мм/);assert.match(await comparison.innerText(),/Взвешенность не подтверждена/);
 assert.match(await comparison.innerText(),/Сравнение с предыдущим исследованием не выполнено/);
 await comparison.getByRole('slider',{name:/Срез основной серии/}).fill('2');
 await comparison.getByRole('button',{name:'Открыть оригинал · срез 3',exact:true}).first().waitFor();
 assert.equal(cloudPosts,0);assert.deepEqual(errors,[]);
 console.log('PASS: two synthetic MR series, nearest parallel source planes, explicit unknown weighting/no prior study, zero cloud POSTs.');
}finally{await browser.close();await rm(temp,{recursive:true,force:true});}
