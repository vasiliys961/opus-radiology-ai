/** Actual Chromium source-NIfTI+four-organ overlay smoke: synthetic pixels only.
 * No network calls, no patient images, no screenshots or model inference.
 */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {createServer} from "node:net";
import {join} from "node:path";

const root=fileURLToPath(new URL("../",import.meta.url));
const require=createRequire(new URL("../web/package.json",import.meta.url));
const {chromium}=require("playwright");
const digest=buffer=>createHash("sha256").update(buffer).digest("hex");
const sizes=[4,3,5],nx=sizes[0],ny=sizes[1];
function header(dims,datatype,bitpix,zStart=0){
  const h=Buffer.alloc(352);
  h.writeInt32LE(348,0);h.writeInt16LE(3,40);
  dims.forEach((n,i)=>h.writeInt16LE(n,42+2*i));
  for(let i=48;i<=54;i+=2)h.writeInt16LE(1,i);
  h.writeInt16LE(datatype,70);h.writeInt16LE(bitpix,72);
  h.writeFloatLE(352,108);h[123]=2;
  h.writeInt16LE(1,254);
  [-1,0,0,-10,0,-2,0,-20,0,0,3,30+zStart*3]
    .forEach((n,i)=>h.writeFloatLE(n,280+4*i));
  Buffer.from([110,43,49,0]).copy(h,344);
  return h;
}
const ct=Buffer.alloc(352+4*3*5*4);
header(sizes,16,32).copy(ct);
for(let i=0;i<60;i++)ct.writeFloatLE(80+i%20,352+i*4);
const sourceSHA=digest(ct);
const mask=Buffer.alloc(352+4*3*2);
header([4,3,2],2,8,1).copy(mask);
const data=mask.subarray(352);
data[1+nx*1]=1;
data[2+nx*1]=2;
data[1+nx*2+nx*ny]=3;
data[1+nx*1+nx*ny]=5;
const proof={
 schema:"opus-totalseg-abdomen-native-mpr-slab/v1",
 researchProfile:"abdomen-four-organs",
 sourceGridGeometry:"native_contiguous_unresampled",
 readyForClinicalUse:false,fullAnatomicCoverageVerified:false,clinicalStatus:"not_validated",
 sourceFullCtSha256:sourceSHA,
 sourceFullMaskSha256:"c".repeat(64),
 slabMaskSha256:digest(mask),
 sourceDimensions:sizes,slabDimensions:[4,3,2],
 firstOriginalSliceIndexZeroBased:1,lastOriginalSliceIndexZeroBased:2,
 labelVoxels:[1,2,3,5].map(id=>({id,voxels:1})),
};
const file=(name,bytes,mimeType="application/octet-stream")=>({name,mimeType,buffer:bytes});
const passphrase=()=>JSON.stringify(proof);
const port=await new Promise((ok,fail)=>{
  const sock=createServer();sock.once("error",fail);
  sock.listen(0,"127.0.0.1",()=>{const p=sock.address().port;sock.close(()=>ok(p));});
});
const url="http://127.0.0.1:"+port;
const web=spawn(process.execPath,["node_modules/next/dist/bin/next","start",
  "--hostname","127.0.0.1","--port",String(port)],{cwd:join(root,"web"),stdio:"ignore"});
let browser,page;const errors=[];let external=false;
try{
  let ready=false;
  for(let i=0;i<120;i++){
    try{if((await fetch(url)).ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(ready,"Next.js local server did not start");
  browser=await chromium.launch({headless:true,args:["--no-sandbox","--use-gl=angle",
    "--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  page=await browser.newPage({viewport:{width:1450,height:960}});
  page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",route=>{
    if(new URL(route.request().url()).origin!==url){
      external=true;return route.abort();
    }
    return route.continue();
  });
  await page.goto(url+"/viewer",{waitUntil:"networkidle"});
  // The trained-model source/result importer MUST be reachable in the visible
  // navigation, not merely present as a lazy component in source code.
  await page.getByRole("button",{name:"MONAI · узлы КТ"}).click();
  await page.locator(".cs-nodule-bound .cs-nodule-controls input[type=file]").first()
    .waitFor({state:"attached",timeout:15000});
  assert.equal(await page.locator(".cs-nodule-bound .cs-nodule-controls input[type=file]").count(),2);
  assert.match(await page.locator(".cs-nodule-bound").innerText(),/MONAI RetinaNet|RetinaNet 0.6.9/);
  await page.getByRole("button",{name:"NIfTI · КТ брюшной полости"}).click();
  const pickers=page.locator(".cs-nifti-controls input[type=file]");
  await pickers.first().waitFor({state:"attached",timeout:15000});
  assert.equal(await pickers.count(),2);
  await pickers.nth(0).setInputFiles(file("synthetic-ct.nii",ct));
  await pickers.nth(1).setInputFiles([
    file("synthetic-mask.nii",mask),
    file("synthetic-mask.json",Buffer.from(passphrase()),"application/json"),
  ]);
  await page.getByRole("button",{name:"Проверить и открыть исследование"}).click();
  await page.locator(".cs-nifti-review h2").waitFor({timeout:30000});
  assert.equal(await page.locator(".cs-nifti-planes canvas").count(),3);
  assert.match(await page.locator(".cs-nifti-review").innerText(),/Селезёнка/);
  assert.match(await page.locator(".cs-nifti-review").innerText(),/Правая почка/);
  assert.match(await page.locator(".cs-nifti-review").innerText(),/Левая почка/);
  assert.match(await page.locator(".cs-nifti-review").innerText(),/Печень/);
  assert.match(await page.locator(".cs-nifti-review").innerText(),/не гарантированные анатомические плоскости/);
  const colorCount=await page.locator(".cs-nifti-planes canvas").evaluateAll(canvases=>canvases.map(canvas=>{
    const rgba=canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data;
    let colored=0;
    for(let i=0;i<rgba.length;i+=4)if(rgba[i]!==rgba[i+1]||rgba[i+1]!==rgba[i+2])colored++;
    return colored;
  }));
  assert.ok(colorCount.length===3 && colorCount.every(n=>n>0),JSON.stringify(colorCount));
  await page.locator(".cs-nifti-organs button").filter({hasText:"Печень"}).click();
  await page.locator(".cs-nifti-sliders select").selectOption("1");
  const bad=Buffer.from(ct);bad.writeFloatLE(0,352);
  await pickers.nth(0).setInputFiles(file("altered-ct.nii",bad));
  assert.equal(await page.locator(".cs-nifti-review").count(),0);
  await page.getByRole("button",{name:"Проверить и открыть исследование"}).click();
  await page.locator(".cs-nifti-error").waitFor();
  assert.match(await page.locator(".cs-nifti-error").innerText(),/SHA-256/);
  assert.ok(!external&&errors.length===0,JSON.stringify(errors));
  console.log(JSON.stringify({schema:"opus-nifti-source-browser-smoke/v1",
    passed:true,syntheticOnly:true,threeIndexedPlanesColorPixels:colorCount,
    trueSourceMaskBinding:true,wrongSourceRejected:true,noExternalRequests:true,
    realMSDBrowserReviewMeasured:false,readyForClinicalUse:false}));
}catch(e){
  console.error("NIfTI browser synthetic check failed",e);
  console.error("page-errors",errors);
  process.exitCode=1;
}finally{
  await browser?.close();
  web.kill("SIGTERM");
}
