import {createHash} from "node:crypto";
import {homedir} from "node:os";
import {join} from "node:path";
import {mkdir,readFile,writeFile,rename,rm} from "node:fs/promises";
import {spawn} from "node:child_process";
const EXPECTED_SHA="2ad046430588270d8235b66645d6205066e8542b32943296491af4a109be9233";
const URI="https://github.com/vasiliys961/opus-radiology-ai/releases/download/onfh-research-v1/onfh-research-v1.npz";
const base=join(homedir(),".cache","opus-radiology-ai","onfh-v1");
export type LocalOnfhAsset={weights:string;sha:string;python:string};
let operation:Promise<LocalOnfhAsset>|null=null;
const verified=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex")===EXPECTED_SHA;
async function run(command:string,args:string[],timeoutMs:number){
 return new Promise<void>((done,fail)=>{
  const child=spawn(command,args,{stdio:"ignore",env:{...process.env,PYTHONNOUSERSITE:"1"}});
  const timeout=setTimeout(()=>child.kill("SIGKILL"),timeoutMs);
  child.on("error",e=>{clearTimeout(timeout);fail(e);});
  child.on("close",code=>{clearTimeout(timeout);code===0?done():fail(Error("onfh_dependency_install_failed"));});
 });
}
async function install():Promise<LocalOnfhAsset>{
 await mkdir(base,{recursive:true,mode:0o700});
 const weights=join(base,"onfh-research-v1.npz");
 let valid=false;
 try{const data=await readFile(weights);valid=data.byteLength>1024&&data.byteLength<128*1024&&verified(data);}
 catch{}
 if(!valid){
  const response=await fetch(URI,{cache:"no-store",signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error("onfh_public_original_checkpoint_not_published");
  if(Number(response.headers.get("content-length")??0)>128*1024)throw Error("onfh_checkpoint_too_large");
  const blob=new Uint8Array(await response.arrayBuffer());
  if(blob.length<1024||blob.length>128*1024||!verified(blob))
   throw Error("onfh_original_trained_checkpoint_sha_mismatch");
  const temp=join(base,".weights-download-"+process.pid+".tmp");
  try{await writeFile(temp,blob,{mode:0o600,flag:"wx"});await rename(temp,weights);}
  finally{await rm(temp,{force:true});}
 }
 const python=join(base,"venv","bin","python");
 try{await run(python,["-c","import numpy,PIL"],4000);}
 catch{
  await rm(join(base,"venv"),{force:true,recursive:true});
  await run(process.env.OPUS_ONFH_PYTHON??"python3",["-m","venv",join(base,"venv")],30000);
  await run(python,["-m","pip","install","--disable-pip-version-check","numpy==2.2.6","pillow==11.3.0"],120000);
  await run(python,["-c","import numpy,PIL"],5000);
 }
 return {weights,sha:EXPECTED_SHA,python};
}
export async function ensureLocalOnfh():Promise<LocalOnfhAsset>{
 if(!operation)operation=install().catch(e=>{operation=null;throw e;});
 return operation;
}
