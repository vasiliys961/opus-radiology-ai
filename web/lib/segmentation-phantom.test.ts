import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { groupDicomSeries, parseDicomSeriesHeader } from "./dicom-series.ts";
import { parseDicomFrame } from "./dicom-lite.ts";
import { assertMaskMatchesSource, parseNiftiMask, sourceGeometry, type Point3 } from "./segmentation-mask.ts";

test("generated synthetic DICOM phantom and masks round-trip through actual readers",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"opus-segmentation-"));
  try {
    const result=spawnSync(process.execPath,[new URL("../../scripts/generate-segmentation-phantom.mjs",import.meta.url).pathname,directory],{encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
    const generated=JSON.parse(result.stdout);
    assert.equal(generated.labels[0].voxels,8130);assert.equal(generated.labels[1].voxels,470);
    const binary = async(path:string) => {
      const b=await readFile(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;
    };
    const members=[];
    for(let i=1;i<=32;i++) {
      const name=`synthetic-${String(i).padStart(3,"0")}.dcm`;
      const buffer=await binary(join(directory,"dicom",name));
      members.push({id:String(i),name,metadata:parseDicomSeriesHeader(buffer)});
      if(i===16) {
        const frame=parseDicomFrame(buffer);
        assert.equal(frame.metadata.width,64);assert.equal(frame.metadata.height,64);
      }
    }
    const [series]=groupDicomSeries(members);
    assert.equal(series.volumeReady,true);assert.equal(series.sliceSpacingMm,2);
    const first=series.members[0].metadata;
    const pos=first.imagePositionPatient!, orient=first.imageOrientationPatient!, spacing=first.pixelSpacing!;
    const normal=[orient[1]*orient[5]-orient[2]*orient[4],orient[2]*orient[3]-orient[0]*orient[5],orient[0]*orient[4]-orient[1]*orient[3]];
    const geometry=sourceGeometry([first.columns!,first.rows!,32],p=>pos.map((v,i)=>v+p[0]*orient[i]*spacing[1]+p[1]*orient[i+3]*spacing[0]+p[2]*normal[i]*series.sliceSpacingMm!) as Point3);
    const mask=parseNiftiMask(await binary(join(directory,"synthetic-mask.nii")));
    assertMaskMatchesSource(mask,geometry);
    assert.deepEqual(mask.labels,generated.labels);
    const shifted=parseNiftiMask(await binary(join(directory,"synthetic-mask-shifted.nii")));
    assert.throws(()=>assertMaskMatchesSource(shifted,geometry),/Положение/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
