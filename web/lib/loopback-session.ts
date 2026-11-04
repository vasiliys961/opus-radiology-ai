/** Server-only tokens for workers started after a weight download.
 * The browser never receives this file. An existing environment token wins.
 */
import {readFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";

const TOKEN=/^[A-Za-z0-9_-]{32,128}$/;
const KEY=/^OPUS_[A-Z0-9_]+$/;
export function loopbackTokens(text:string):Record<string,string>{
  let data:unknown;
  try{data=JSON.parse(text);}catch{return {};}
  if(!data||typeof data!=="object"||Array.isArray(data))return {};
  const workers=(data as {workers?:unknown}).workers;
  if(!workers||typeof workers!=="object"||Array.isArray(workers))return {};
  const out:Record<string,string>={};
  for(const [key,value] of Object.entries(workers)){
    if(KEY.test(key)&&typeof value==="string"&&TOKEN.test(value))out[key]=value;
  }
  return out;
}
export function readLoopbackTokens():Record<string,string>{
  const root=process.env.OPUS_MODEL_CACHE||path.join(os.homedir(),".cache","opus-radiology","original-models");
  try{return loopbackTokens(readFileSync(path.join(root,"loopback-session.json"),"utf8"));}
  catch{return {};}
}
export function tokenFor(name:string):string{
  const env=process.env[name]??"";
  if(TOKEN.test(env))return env;
  return readLoopbackTokens()[name]??"";
}
