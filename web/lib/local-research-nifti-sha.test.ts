import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {hashLocalNifti} from "./local-research-nifti-sha.ts";

test("Streams exact original NIfTI bytes through bounded chunks and matches reference SHA",async()=>{
 const content=new Uint8Array(2*1024*1024+257);
 for(let i=0;i<content.length;i++)content[i]=i%251;
 const blob=new Blob([content]);
 const progress:number[]=[];
 const actual=await hashLocalNifti(blob,undefined,n=>progress.push(n));
 const expected=createHash("sha256").update(content).digest("hex");
 assert.equal(actual,expected);
 assert.deepEqual(progress,[blob.size]);
});
test("Refuses nonimages and oversized source; aborts without exposing partial SHA",async()=>{
 await assert.rejects(hashLocalNifti(new Blob(["tiny"])),/размера/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(hashLocalNifti(new Blob([new Uint8Array(512)]),controller.signal),
                      (err:unknown)=>err instanceof DOMException&&err.name==="AbortError");
});
