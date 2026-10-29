/** One original pretrained NIH DenseNet121 => SIX scores, one CXR modality.
 * A score is not a diagnosis, calibrated probability or spatial bounding box.
 */
export const XRV_CXR_LABELS=[
 "Pneumothorax","Cardiomegaly","Effusion","Pneumonia","Edema","Mass",
] as const;
export type XrvCxrLabel=(typeof XRV_CXR_LABELS)[number];
export type OriginalXrvCxrResult={
 schema:"opus-original-xrv-cxr-six-head/v1";
 sourcePngSha256:string;
 model:"densenet121-res224-nih";
 modelWeightSha256:string;
 actualPretrainedModelForwardCompleted:true;
 labels:Record<XrvCxrLabel,number>;
 spatialLocalizationSupported:false;
 clinicalValidation:false;
 scoresAreCalibratedProbabilities:false;
 negativeDiagnosisPermitted:false;
 patientMode:false;
 limitations:string[];
};
export const SHA_XRV="31a5475c6b1383a7edbfcaf96af9ce302eb9969cfe28b6b8b5859afc6f274fdf";
const sha=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
export function parseOriginalXrvReport(value:unknown,expectedSourceSha?:string):OriginalXrvCxrResult{
 if(!value||typeof value!=="object"||Array.isArray(value))
   throw Error("Неизвестный отчёт оригинальной модели CXR.");
 const r=value as Record<string,unknown>;
 const labels=r.labels;
 if(r.schema!=="opus-original-xrv-cxr-six-head/v1"||
   r.model!=="densenet121-res224-nih"||
   r.modelWeightSha256!==SHA_XRV||
   !sha(r.sourcePngSha256)||(expectedSourceSha&&r.sourcePngSha256!==expectedSourceSha)||
   r.actualPretrainedModelForwardCompleted!==true||
   r.spatialLocalizationSupported!==false||
   r.clinicalValidation!==false||
   r.scoresAreCalibratedProbabilities!==false||
   r.negativeDiagnosisPermitted!==false||
   r.patientMode!==false||
   !labels||typeof labels!=="object"||Array.isArray(labels)||
   Object.keys(labels).sort().join(",")!==[...XRV_CXR_LABELS].sort().join(",")||
   !Object.values(labels).every(v=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=1)||
   !Array.isArray(r.limitations)||r.limitations.length<3)
  throw Error("Нельзя привязать шесть оригинальных оценок CXR к этой модели и снимку.");
 return value as OriginalXrvCxrResult;
}
export async function runCxrXrvFromDicom(
 file:File,publicUrl:string,authorized:boolean,signal:AbortSignal,
 onStatus:(v:string)=>void=()=>{},
):Promise<OriginalXrvCxrResult>{
 if(!authorized||!/https:\/\/[^@?#\s]{4,1024}$/.test(publicUrl)||!publicUrl.startsWith("https://"))
  throw Error("Допускается только подтверждённое публичное исследовательское изображение.");
 // Uses exact uncompressed monochrome native pixel values. No JPEG/secondary.
 const {decodeDicomPreview}=await import("./dicom-lite.ts");
 onStatus("Создаём исходный PNG из подтверждённой рентгенограммы DICOM...");
 const preview=await decodeDicomPreview(file,{maxPixels:4096*4096});
 if(preview.metadata.modality!=="CR"&&preview.metadata.modality!=="DX")
  throw Error("TorchXRayVision требуется настоящая CR/DX рентгенограмма.");
 const text=preview.url.split(",")[1];
 if(!text)throw Error("Не удалось декодировать исходную рентгенограмму.");
 const raw=atob(text);
 if(raw.length<1024||raw.length>25*1024*1024)
  throw Error("Размер исходной рентгенограммы вне ограничения Linux-модели.");
 const bytes=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 if(signal.aborted)throw new DOMException("Анализ отменён.","AbortError");
 onStatus("Настоящий оригинальный TorchXRayVision оценивает шесть NIH-признаков...");
 const result=await fetch("/api/local-xrv",{
  method:"POST",cache:"no-store",credentials:"same-origin",signal,
  headers:{"Content-Type":"image/png","X-Opus-Public-Research-Authorized":"yes",
   "X-Opus-Public-Source-URL":publicUrl},
  body:new Blob([bytes],{type:"image/png"}),
 });
 if(!result.ok)throw Error("Оригинальная модель CXR не готова (HTTP "+result.status+").");
 const body=await result.text();
 if(body.length>16384)throw Error("Ответ TorchXRayVision превышает допустимый объём.");
 return parseOriginalXrvReport(JSON.parse(body));
}
export async function checkOriginalXrvReady(signal?:AbortSignal):Promise<boolean>{
 const response=await fetch("/api/local-xrv",{
  method:"GET",credentials:"same-origin",cache:"no-store",signal,
 });
 if(!response.ok)return false;
 const value:unknown=await response.json();
 return Boolean(value&&typeof value==="object"&&(value as {ready?:boolean}).ready===true);
}
