/**
 * Public research reference only. No patient input, no proxy URL, no PHI,
 * no model execution and no download of full CT pixels.
 *
 * These are the same immutable assets used by successful MONAI CPU run
 * https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38436406805
 */
import {createHash} from "node:crypto";
import {NextResponse} from "next/server";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const UID="1.3.6.1.4.1.14519.5.2.1.6279.6001.395623571499047043765181005112";
const UID_SHA="0e70f7a05cf8963ea61614a599ebb6fb59ad661bd03299d3058ad14d485b2d76";
const ANNOTATIONS_SHA="db9adb75b381f3e95b1f601d9b63f2e42bd6536ab5a06dc539c5ec8a4005cec7";
const MHD_SHA="5a1320abf573d50422961f5340e3f8f6391c23f3a13e29a18322034958f6ac1c";
const CSV_URL="https://huggingface.co/datasets/MedOtter/LUNA16/resolve/fb396557c4e23feaf9c432cea7fc8426214648fb/annotations.csv";
const MHD_URL="https://huggingface.co/datasets/Yousra0x0/LUNA16_RAW/resolve/af8fdf04c27dcaa97ccfd755043d8096299d6a40/subset0/"+UID+".mhd";
const digest=(data:Uint8Array|string)=>createHash("sha256").update(data).digest("hex");
type Triplet=[number,number,number];

async function pinnedText(url:string,sha:string,max:number):Promise<string>{
  const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error("public_reference_unavailable");
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length<50||bytes.length>max||digest(bytes)!==sha)throw Error("public_reference_integrity_failed");
  return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
}

function vector(value:string,n:number,label:string):number[]{
  const pieces=value.trim().split(/\s+/);
  if(pieces.length!==n)throw Error("invalid_"+label);
  const result=pieces.map(Number);
  if(result.some(x=>!Number.isFinite(x)))throw Error("invalid_"+label);
  return result;
}
function headerGeometry(raw:string){
  if(raw.length>2048||raw.includes("\u0000"))throw Error("invalid_source_header");
  const fields=new Map<string,string>();
  for(const line of raw.split(/\r?\n/)){
    if(!line.trim()||line.trim().startsWith("#"))continue;
    const index=line.indexOf("=");
    if(index<1)throw Error("invalid_source_header");
    const key=line.slice(0,index).trim(),value=line.slice(index+1).trim();
    if(fields.has(key))throw Error("ambiguous_source_header");
    fields.set(key,value);
  }
  if(fields.get("NDims")!=="3"||fields.get("ElementType")!=="MET_SHORT"||
     fields.get("ElementDataFile")!==UID+".raw"||
     (fields.get("CompressedData")??"False").toLowerCase()!=="false"||
     (fields.get("BinaryData")??"True").toLowerCase()!=="true"||
     (fields.get("ElementNumberOfChannels")??"1")!=="1"||
     (fields.get("ElementByteOrderMSB")??"False").toLowerCase()!=="false"||
     (fields.get("BinaryDataByteOrderMSB")??"False").toLowerCase()!=="false")
     throw Error("wrong_public_source");
  const dims=vector(fields.get("DimSize")??"",3,"dimensions");
  const spacing=vector(fields.get("ElementSpacing")??"",3,"spacing");
  if(dims.some((n,i)=>n!==[512,512,109][i])||
     spacing.some((n,i)=>Math.abs(n-[0.78125,0.78125,2.5][i])>1e-5))
     throw Error("public_source_geometry_changed");
  const origins=["Offset","Position","Origin"].filter(k=>fields.has(k));
  if(origins.length!==1)throw Error("ambiguous_source_origin");
  const origin=vector(fields.get(origins[0])??"",3,"origin") as Triplet;
  const flat=vector(fields.get("TransformMatrix")??"",9,"direction");
  const direction=[flat.slice(0,3),flat.slice(3,6),flat.slice(6,9)];
  for(let c=0;c<3;c++){
    for(let d=c;d<3;d++){
      const dot=direction.reduce((sum,row)=>sum+row[c]*row[d],0);
      if(Math.abs(dot-(c===d?1:0))>1e-4)throw Error("invalid_direction_matrix");
    }
  }
  return {dimensions:dims,spacingMm:spacing,origin,directionMatrix:direction};
}
function voxelIndex(center:Triplet,g:ReturnType<typeof headerGeometry>):Triplet{
  const delta=center.map((v,i)=>v-g.origin[i]);
  const idx=[0,1,2].map(c=>
    g.directionMatrix.reduce((total,row,r)=>total+row[c]*delta[r],0)/g.spacingMm[c]
  ) as Triplet;
  if(idx.some((v,i)=>v<-.5||v>g.dimensions[i]-.5))throw Error("reference_outside_public_ct");
  return idx;
}
function referenceAnnotations(csv:string){
  const lines=csv.replace(/\r/g,"").trim().split("\n");
  if(lines.shift()!=="seriesuid,coordX,coordY,coordZ,diameter_mm")
    throw Error("unexpected_luna16_annotation_format");
  const refs:{centerMm:Triplet;diameterMm:number}[]=[];
  for(const line of lines){
    if(!line)continue;
    const fields=line.split(",");
    if(fields.length!==5)throw Error("invalid_luna16_annotation_row");
    if(fields[0]!==UID)continue;
    const center=fields.slice(1,4).map(Number) as Triplet;
    const diameter=Number(fields[4]);
    if(center.some(v=>!Number.isFinite(v))||
       !Number.isFinite(diameter)||diameter<3||diameter>150)
       throw Error("invalid_luna16_reference_nodule");
    refs.push({centerMm:center,diameterMm:diameter});
  }
  if(refs.length!==1)throw Error("unexpected_reference_count");
  return refs;
}
/** Only a FIXED, vetted public example is retrievable. No patient request body. */
export async function GET(){
  try{
    if(digest(UID)!==UID_SHA)throw Error("public_study_id_changed");
    const [annotations,header]=await Promise.all([
      pinnedText(CSV_URL,ANNOTATIONS_SHA,512000),
      pinnedText(MHD_URL,MHD_SHA,2048),
    ]);
    const geometry=headerGeometry(header);
    const referenceNodules=referenceAnnotations(annotations).map(r=>{
      const nativeVoxelIndex=voxelIndex(r.centerMm,geometry);
      return {...r,nativeVoxelIndex,sliceIndex0Based:Math.round(nativeVoxelIndex[2])};
    });
    return NextResponse.json({
      schema:"opus-luna16-real-public-reference/v1",
      sourceSeriesIdSha256:UID_SHA,
      sourceMhdSha256:MHD_SHA,
      annotationsSha256:ANNOTATIONS_SHA,
      sourceGeometry:geometry,
      referenceNodules,
      source:"LUNA16 expert annotations and original MetaImage header",
      coordinateMappingStatus:"model_to_source_not_independently_validated",
      independentHoldout:false,
      clinicalValidation:false,
    },{headers:{"Cache-Control":"public, max-age=600"}});
  }catch(error){
    const reason=error instanceof Error?error.message:"unknown_error";
    console.warn("Public LUNA16 reference load failed:",reason);
    return NextResponse.json({error:"Проверенные публичные данные разметки сейчас недоступны."},
      {status:502,headers:{"Cache-Control":"no-store"}});
  }
}
