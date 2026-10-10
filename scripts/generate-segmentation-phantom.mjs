/** Deterministic synthetic geometry fixture. No patient data and no anatomical model. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const destination = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../test-data/generated-segmentation-phantom/",import.meta.url));
const slices = resolve(destination,"dicom");
await mkdir(slices,{recursive:true});
const nx=64,ny=64,nz=32;
const labelData=Buffer.alloc(nx*ny*nz*2);
const counts=[0,0,0];
const us = n => {const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;};
const ul = n => {const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const tag = (group,element,vr,payload) => {
  const value=typeof payload==="string" ? Buffer.from(payload,"ascii") : payload;
  const long=["OB","OW","SQ","UN","UT"].includes(vr), size=value.length+(value.length%2);
  const header=Buffer.alloc(long?12:8);header.writeUInt16LE(group,0);header.writeUInt16LE(element,2);header.write(vr,4,"ascii");
  if(long)header.writeUInt32LE(size,8);else header.writeUInt16LE(size,6);
  return Buffer.concat([header,value,value.length%2?Buffer.from([vr==="UI"||long?0:32]):Buffer.alloc(0)]);
};
const sopClass="1.2.840.10008.5.1.4.1.1.4", root="2.25.1043521000001";
for(let k=0;k<nz;k++) {
  const pixels=Buffer.alloc(nx*ny*2);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++) {
    const x=i-32,y=j-32,z=k*2-31;
    const outer=x*x+y*y+z*z<16*16;
    const inner=(x-9)**2+(y+2)**2+z*z<6*6;
    const label=inner?2:outer?1:0;
    const signal=label===2?1400:label===1?Math.round(850+200*x/16):0;
    pixels.writeUInt16LE(signal,(i+nx*j)*2);
    labelData.writeUInt16LE(label,(i+nx*(j+ny*k))*2);counts[label]++;
  }
  const instance=`${root}.4.${k+1}`;
  const meta=Buffer.concat([
    tag(2,1,"OB",Buffer.from([0,1])),tag(2,2,"UI",sopClass),tag(2,3,"UI",instance),
    tag(2,0x10,"UI","1.2.840.10008.1.2.1"),tag(2,0x12,"UI",`${root}.9`),
  ]);
  const dataset=Buffer.concat([
    tag(8,0x16,"UI",sopClass),tag(8,0x18,"UI",instance),tag(8,0x60,"CS","MR"),
    tag(8,0x103e,"LO","SYNTHETIC PHANTOM - NOT PATIENT DATA"),
    tag(0x18,0x50,"DS","2"),tag(0x18,0x88,"DS","2"),
    tag(0x20,0x0d,"UI",`${root}.1`),tag(0x20,0x0e,"UI",`${root}.2`),tag(0x20,0x13,"IS",String(k+1)),
    tag(0x20,0x32,"DS",`-32\\-32\\${k*2-31}`),tag(0x20,0x37,"DS","1\\0\\0\\0\\1\\0"),tag(0x20,0x52,"UI",`${root}.3`),
    tag(0x28,2,"US",us(1)),tag(0x28,4,"CS","MONOCHROME2"),
    tag(0x28,0x10,"US",us(ny)),tag(0x28,0x11,"US",us(nx)),tag(0x28,0x30,"DS","1\\1"),
    tag(0x28,0x100,"US",us(16)),tag(0x28,0x101,"US",us(12)),tag(0x28,0x102,"US",us(11)),tag(0x28,0x103,"US",us(0)),
    tag(0x28,0x1050,"DS","700"),tag(0x28,0x1051,"DS","1400"),tag(0x7fe0,0x10,"OW",pixels),
  ]);
  await writeFile(resolve(slices,`synthetic-${String(k+1).padStart(3,"0")}.dcm`),Buffer.concat([Buffer.alloc(128),Buffer.from("DICM"),tag(2,0,"UL",ul(meta.length)),meta,dataset]));
}
function nifti(shift) {
  const h=Buffer.alloc(352);h.writeInt32LE(348,0);h.writeInt16LE(3,40);
  [nx,ny,nz].forEach((n,i)=>h.writeInt16LE(n,42+i*2));
  h.writeInt16LE(1002,68);h.writeInt16LE(512,70);h.writeInt16LE(16,72);
  [1,1,1,2].forEach((n,i)=>h.writeFloatLE(n,76+i*4));
  h.writeFloatLE(352,108);h.writeUInt8(2,123);h.write("SYNTHETIC PHANTOM - NOT PATIENT DATA",148,"ascii");
  h.writeInt16LE(1,254);
  // DICOM LPS origin [-32,-32,-31], so NIfTI RAS origin [32,32,-31].
  [-1,0,0,32+shift,0,-1,0,32,0,0,2,-31].forEach((n,i)=>h.writeFloatLE(n,280+i*4));
  h.write("n+1\0",344,"ascii");return Buffer.concat([h,labelData]);
}
await writeFile(resolve(destination,"synthetic-mask.nii"),nifti(0));
await writeFile(resolve(destination,"synthetic-mask-shifted.nii"),nifti(1));
console.log(JSON.stringify({destination,dicomDirectory:slices,sourceGrid:[nx,ny,nz],spacingMm:[1,1,2],
  labels:counts.slice(1).map((voxels,i)=>({id:i+1,voxels,volumeMl:voxels*2/1000})),
  expected:"synthetic-mask.nii matches; synthetic-mask-shifted.nii must be rejected. This is not clinical validation."},null,2));
