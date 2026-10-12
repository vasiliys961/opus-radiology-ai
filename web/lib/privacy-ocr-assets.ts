/** Package-lock integrity plus exact deployed-file checks. Only local GET assets. */
export const OCR_ASSET_PREFIX="/api/privacy-ocr/assets/v1/";
export const OCR_ASSETS:Readonly<Record<string,{path:string;sha256:string}>>={
  "tesseract.min.js":{path:"tesseract.js/dist/tesseract.min.js",sha256:"10fff78484067759c43028a02a72d76d0b90eb17302bb23b58a9ec5410bc928b"},
  "worker.min.js":{path:"tesseract.js/dist/worker.min.js",sha256:"38645599043239c0eb6db08a6504a92dcdc292200535f3e9339cd77c4443b842"},
  "eng.traineddata.gz":{path:"@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",sha256:"45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91"},
  "rus.traineddata.gz":{path:"@tesseract.js-data/rus/4.0.0_best_int/rus.traineddata.gz",sha256:"f51f5edc992249ff9b70a227b22f242dfa47b2b1bbc7ae0ea74908640c101f6a"},
  "tesseract-core-lstm.wasm.js":{path:"tesseract.js-core/tesseract-core-lstm.wasm.js",sha256:"775a35df6f2ae100e02609443e6bd5cafcd07983dd6175454ca4a432a7730687"},
  "tesseract-core-lstm.wasm":{path:"tesseract.js-core/tesseract-core-lstm.wasm",sha256:"220e2e87551edccb85519796a170469f8ab2a8055216789e3b8b1ada18b7bc2b"},
  "tesseract-core-simd-lstm.wasm.js":{path:"tesseract.js-core/tesseract-core-simd-lstm.wasm.js",sha256:"9d7c43fb206dc9f48475228b46bf35f888fa9e6259da2e67d5a75c77049f2dc7"},
  "tesseract-core-simd-lstm.wasm":{path:"tesseract.js-core/tesseract-core-simd-lstm.wasm",sha256:"187d76742dfc0d8929f0b49a619f145bb6370730776c7bd0d3e20c6b2098808d"},
};
/** Runs inside each owned worker; rejects default CDN URLs, POSTs and persistence. */
export const OCR_NETWORK_GUARD=`
const assetRoot=new URL('${OCR_ASSET_PREFIX}',self.location.origin);
function localAsset(value){const url=new URL(String(value),self.location.href);
  if(url.origin!==assetRoot.origin||!url.pathname.startsWith(assetRoot.pathname)||url.search||url.hash)throw Error('OCR asset denied');return url.href;}
const originalFetch=self.fetch.bind(self),originalImport=self.importScripts.bind(self);
self.fetch=(value,options={})=>{if((options.method||'GET')!=='GET'||options.body)throw Error('OCR request denied');
  // Pinned Emscripten builds embed their public WASM binary in a data URI.
  if(typeof value==='string'&&value.startsWith('data:application/octet-stream;base64,')&&value.length<6000000)
    return originalFetch(value,{...options,credentials:'omit',redirect:'error'});
  return originalFetch(localAsset(value),{...options,credentials:'omit',redirect:'error',cache:'no-store'});};
self.importScripts=(...values)=>originalImport(...values.map(localAsset));
for(const key of ['log','warn','error','info','debug'])console[key]=()=>{};
`;

/** Host owns even initializing child workers, so cancellation needn't await createWorker. */
export const OCR_HOST_SCRIPT=OCR_NETWORK_GUARD+`
const children=new Set(),NativeWorker=self.Worker;
self.Worker=class extends NativeWorker{constructor(url,options){super(localAsset(url),options);children.add(this);}};
let started=false;
function stop(){for(const child of children)child.terminate();children.clear();self.postMessage({kind:'stopped'});self.close();}
self.onmessage=async({data})=>{
  if(data?.kind==='stop'){stop();return;}if(started||data?.kind!=='scan')return;started=true;
  let stage='input';try{
    const {pngBase64,width,height,sha256}=data;
    if(typeof pngBase64!=='string'||pngBase64.length>2796204||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
      width<1||height<1||width*height>1048576||!/^[a-f0-9]{64}$/.test(sha256))throw Error('Invalid OCR input');
    stage='runtime';self.importScripts(assetRoot.href+'tesseract.min.js');
    stage='initialize';
    const engine=await Tesseract.createWorker('eng+rus',1,{workerPath:assetRoot.href+'engine-worker.js',corePath:assetRoot.href,
      langPath:assetRoot.href,workerBlobURL:false,cacheMethod:'none',logger:()=>{},errorHandler:()=>{}},
      {load_system_dawg:'0',load_freq_dawg:'0'});
    stage='recognize';await engine.setParameters({tessedit_pageseg_mode:'11',user_defined_dpi:'150'});
    const result=await engine.recognize('data:image/png;base64,'+pngBase64,{}, {text:false,blocks:true});
    stage='output';if(!Array.isArray(result.data.blocks))throw Error('Missing OCR output');
    const boxes=[];
    for(const block of result.data.blocks)for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[])for(const word of line.words||[]){
      if(boxes.length>=64)throw Error('OCR region limit');
      boxes.push({bbox:word.bbox,confidence:word.confidence});
    }
    await engine.terminate();self.postMessage({kind:'result',sha256,boxes});
  }catch{self.postMessage({kind:'failed',stage});}
};
`;
