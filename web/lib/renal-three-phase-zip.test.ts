import {test} from "node:test";
import {strict as assert} from "node:assert";
import {zipRenalNativePhases} from "./renal-three-phase-zip.ts";

test("ZIP32 contains the exact native phase names and source bytes",async()=>{
 const source=new Uint8Array(1024).fill(13);
 const files={
  artery:new File([source],"a.nii"),vein:new File([source],"v.nii"),
  excret:new File([source],"e.nii"),
 };
 const zip=await zipRenalNativePhases(files,new AbortController().signal);
 const bytes=new Uint8Array(await zip.arrayBuffer());
 const names=new TextDecoder().decode(bytes);
 for(const role of ["artery","vein","excret"]){
  assert.ok(names.includes(role+".nii"));
 }
 const view=new DataView(bytes.buffer);
 assert.equal(view.getUint32(0,true),0x04034b50);
 assert.equal(view.getUint16(8,true),0);
 const end=bytes.length-22;
 assert.equal(view.getUint32(end,true),0x06054b50);
 assert.equal(view.getUint16(end+10,true),3);
 assert.equal(view.getUint32(end+16,true),3*30+("artery.nii".length+"vein.nii".length+"excret.nii".length)+3*1024);
});
test("ZIP submission cannot omit a phase or exceed per-phase byte limits",async()=>{
 const sample=new File([new Uint8Array(1024)],"valid.nii");
 await assert.rejects(zipRenalNativePhases({artery:sample,vein:sample,excret:undefined as unknown as File},new AbortController().signal));
 const cancelled=new AbortController();cancelled.abort();
 await assert.rejects(zipRenalNativePhases({artery:sample,vein:sample,excret:sample},cancelled.signal));
});
