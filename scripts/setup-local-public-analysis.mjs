#!/usr/bin/env node
/**
 * One-time administrator provisioning for localhost-only, deidentified PUBLIC
 * CT/MR research. Not a patient/cloud opt-in and never modifies GitHub secrets.
 */
import {readFile,writeFile,chmod} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createInterface} from "node:readline/promises";
const root=join(dirname(fileURLToPath(import.meta.url)),"../web");
const path=join(root,".env.local");
let original="";
try{original=await readFile(path,"utf8");}catch(error){
 if(error.code!=="ENOENT")throw error;
}
const unquote=s=>s?.trim().replace(/^["']|["']$/g,"")??"";
function get(k){
 const entry=original.split(/\r?\n/).find(line=>line.match(new RegExp("^\\s*"+k+"\\s*=")));
 return entry?unquote(entry.slice(entry.indexOf("=")+1)):process.env[k]??"";
}
function upsert(k,v){
 const lines=original.replace(/\r\n/g,"\n").split("\n");
 const index=lines.findIndex(line=>new RegExp("^\\s*"+k+"\\s*=").test(line));
 const entry=k+"="+v;
 if(index>=0)lines[index]=entry;else lines.push(entry);
 original=lines.join("\n").trimEnd()+"\n";
}
async function hidden(prompt){
 if(!process.stdin.isTTY)throw Error("Для ввода ключа запустите команду в обычном Terminal.");
 process.stdout.write(prompt);
 const wasRaw=process.stdin.isRaw;
 process.stdin.setRawMode(true);process.stdin.resume();
 return await new Promise((resolve,reject)=>{
  let value="";
  function end(error){
   process.stdin.off("data",onData);process.stdin.setRawMode(Boolean(wasRaw));process.stdin.pause();
   process.stdout.write("\n");
   if(error)reject(error);else resolve(value.trim());
  }
  function onData(chunk){
   for(const ch of chunk.toString("utf8")){
    if(ch==="\u0003"){end(Error("Ввод отменён."));return;}
    if(ch==="\r"||ch==="\n"){end();return;}
    if(ch==="\u007f"||ch==="\b"){value=value.slice(0,-1);continue;}
    if(ch>=" "&&ch!=="\u007f")value+=ch;
   }
  }
  process.stdin.on("data",onData);
 });
}
const rl=createInterface({input:process.stdin,output:process.stdout});
try{
 console.log("\nНастройка автоматического анализа Gemini → Claude Opus.");
 console.log("Только публичные/учебные обезличенные КТ и МРТ на локальном компьютере.");
 console.log("Обычные изображения пациентов этим режимом отправлять нельзя.\n");
 const confirm=(await rl.question("Подтверждаете законность передачи этих данных и условия OpenRouter для медицинских данных? (напишите ДА): ")).trim();
 if(confirm!=="ДА")throw Error("Настройка не выполнена: требуется явное подтверждение администратора.");
}finally{rl.close();}
let apiKey=get("OPENROUTER_API_KEY");
if(!apiKey)apiKey=await hidden("Введите ключ OpenRouter (ввод скрыт): ");
if(!apiKey||apiKey.length<12||/[\s\r\n]/.test(apiKey))
 throw Error("Ключ OpenRouter не найден или выглядит некорректно. Файл не изменён.");
upsert("OPENROUTER_API_KEY",apiKey);
upsert("RADIOLOGY_ENABLE_AUTOMATIC_PUBLIC_VOLUME_RESEARCH","1");
upsert("RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT","1");
upsert("RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED","1");
upsert("RADIOLOGY_LOCAL_RESEARCH_AUTO_CONNECT","1");
const existingToken=get("RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN");
upsert("RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN",
 existingToken.length>=24?existingToken:randomBytes(32).toString("hex"));
await writeFile(path,original,{mode:0o600});
await chmod(path,0o600);
console.log("\nЛокальное исследовательское рабочее место настроено.");
console.log("Ключ и код подключения сохранены только в web/.env.local и не выводятся.");
console.log("Перезапустите npm run dev, затем снова нажмите «Анализировать исследование».");
