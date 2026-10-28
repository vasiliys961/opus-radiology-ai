import type {DicomSeries} from "./dicom-series.ts";

type Component={component:number;voxels:number;volumeMl:number;
 sourceVoxelBoundsInclusive:[[number,number,number],[number,number,number]];
 centroidNiftiRasMm:[number,number,number]};
export type BoundWmh={sourceHash:string;checkpointHash:string;components:Component[];totalMl:number};
const sha=/^[a-f0-9]{64}$/;
export async function bindWmhToSelectedDicom(
 raw:unknown,series:DicomSeries,files:ReadonlyMap<string,File|Blob>,
):Promise<BoundWmh>{
 if(series.modality!=="MR"||!series.volumeReady||!series.spatiallySorted||
    !series.members.length||!series.members.every(m=>m.metadata.bodyRegion==="HEAD"))
   throw Error("Требуется исходная МРТ головы с проверенной геометрией.");
 if(!raw||typeof raw!=="object")throw Error("Неверный WMH-отчёт.");
 const obj=raw as Record<string,unknown>;
 const conversion=obj.conversion as Record<string,unknown>|undefined;
 const inference=obj.inference as Record<string,unknown>|undefined;
 if(!conversion||!inference||inference.schema!=="opus-original-wmh-source-MRI-CPU-research/v1"||
   inference.realTrainedOriginalWMHModelForwardCompleted!==true||
   conversion.modelInferenceCompleted!==false||
   conversion.nativeGeometryPreserved!==true||
   inference.sourceFLAIRSHA256!==conversion.sourceFLAIRSHA256||
   typeof inference.checkpointSHA256!=="string"||!sha.test(inference.checkpointSHA256)||
   typeof conversion.sourceFLAIRSHA256!=="string"||!sha.test(conversion.sourceFLAIRSHA256))
   throw Error("Отсутствует подтверждённый исходный WMH-инференс.");
 const uids=conversion.sourceSOPInstanceUIDs,hashes=conversion.sourceDicomSHA256;
 const dims=conversion.dimensions;
 if(!Array.isArray(uids)||!Array.isArray(hashes)||!Array.isArray(dims)||
   uids.length!==series.members.length||hashes.length!==uids.length||
   dims.length!==3||dims[0]!==series.members[0].metadata.columns||
   dims[1]!==series.members[0].metadata.rows||dims[2]!==uids.length)
   throw Error("WMH-отчёт относится к другой серии или сетке.");
 const map=new Map<string,string>();
 for(let i=0;i<uids.length;i++){
   if(typeof uids[i]!=="string"||typeof hashes[i]!=="string"||!sha.test(hashes[i])||map.has(uids[i]))
     throw Error("Дублированная либо непроверенная идентичность WMH-среза.");
   map.set(uids[i],hashes[i]);
 }
 // Verify actual bytes, not merely DICOM UIDs. One file in memory at a time.
 for(const m of series.members){
   const file=files.get(m.id),expected=map.get(m.metadata.sopInstanceUid??"");
   if(!file||!expected)throw Error("Исходный DICOM-срез WMH отсутствует.");
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer())),x=>x.toString(16).padStart(2,"0")).join("");
   if(digest!==expected)throw Error("SHA-256 DICOM-среза не совпадает с WMH-отчётом.");
 }
 const candidates=inference.candidateComponents;
 if(!Array.isArray(candidates)||candidates.length>5000||
    inference.candidateComponentCount!==candidates.length||
    typeof inference.totalPredictedHyperintensityMl!=="number")
   throw Error("Неверный состав WMH-находок.");
 const values:Component[]=[];
 for(const x of candidates){
   if(!x||typeof x!=="object")throw Error("Неверная WMH-находка.");
   const a=x as Record<string,unknown>,bounds=a.sourceVoxelBoundsInclusive;
   if(!Array.isArray(bounds)||bounds.length!==2||!bounds.every(b=>Array.isArray(b)&&b.length===3)||
      !bounds.every((b,i)=>(b as number[]).every((v,j)=>Number.isInteger(v)&&v>=0&&v<dims[j]))||
      (bounds[0] as number[]).some((v,j)=>v>(bounds[1] as number[])[j])||
      !Number.isInteger(a.component)||!Number.isInteger(a.voxels)||Number(a.voxels)<=0||
      typeof a.volumeMl!=="number"||a.volumeMl<0||!Number.isFinite(a.volumeMl)||
      !Array.isArray(a.centroidNiftiRasMm)||a.centroidNiftiRasMm.length!==3||
      !a.centroidNiftiRasMm.every((v:unknown)=>typeof v==="number"&&Number.isFinite(v)))
       throw Error("Некорректная локализация WMH-находки.");
   values.push(a as unknown as Component);
 }
 return {sourceHash:conversion.sourceFLAIRSHA256,checkpointHash:inference.checkpointSHA256,
  components:values,totalMl:inference.totalPredictedHyperintensityMl as number};
}
