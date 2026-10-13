/** Browser-side, bounded, source-grid positions for reviewing real research lobe masks.
 * An anchor is an occupied label voxel nearest the label centroid, NOT a lesion.
 * No label, volume or boundary is considered independently clinically verified.
 */
import {transformPoint,type LabelMask,type Point3} from "./segmentation-mask.ts";
import type {ResearchLobes} from "./totalseg-research-import.ts";

export type LobeRegion={
  id:number;
  name:string;
  voxels:number;
  volumeMl:number;
  boundsMaskIndex:{min:Point3;max:Point3};
  originalSliceRange:[number,number];
  anchorMaskIndex:Point3;
  anchorLpsMm:Point3;
  status:"unverified_research";
};
type MutableRegion={
  count:number;
  min:Point3;max:Point3;
  sums:[number,number,number];
  closest:Point3;
  closestDistance:number;
};
const IDS=[10,11,12,13,14] as const;
const CHUNK=65536;
const yieldToUi=()=>new Promise<void>(resolve=>setTimeout(resolve,0));

/** Two linear scans; at most five records beyond the existing Uint16 mask buffer.
 * Supports cancellation when the active MPR series or file selection changes.
 */
export async function buildResearchLobeRegions(
  mask:LabelMask,proof:ResearchLobes,
  options:{cancelled?:()=>boolean;yieldControl?:()=>Promise<void>}={}
):Promise<LobeRegion[]>{
  const [nx,ny,nz]=mask.dimensions;
  const size=nx*ny*nz;
  if(!Number.isSafeInteger(size)||size<1||size>8388608||size!==mask.data.length||
      nz!==proof.lastSlice-proof.firstSlice+1||
      !Number.isFinite(mask.voxelVolumeMm3)||mask.voxelVolumeMm3<=0)
    throw Error("Неверный размер или масштаб исследовательской маски.");
  const check=()=>{if(options.cancelled?.())throw Error("Подготовка навигации отменена.");};
  const yieldControl=options.yieldControl??yieldToUi;
  const entries=new Map<number,MutableRegion>();
  for(const id of IDS)entries.set(id,{
    count:0,min:[nx,ny,nz],max:[-1,-1,-1],sums:[0,0,0],
    closest:[0,0,0],closestDistance:Infinity,
  });
  for(let start=0;start<size;start+=CHUNK){
    check();
    for(let i=start;i<Math.min(start+CHUNK,size);i++){
      const id=mask.data[i];if(!id)continue;
      const r=entries.get(id);
      if(!r)throw Error("В маске неизвестная анатомическая метка.");
      const x=i%nx,y=Math.floor(i/nx)%ny,z=Math.floor(i/(nx*ny));
      r.count++;
      r.sums[0]+=x;r.sums[1]+=y;r.sums[2]+=z;
      r.min[0]=Math.min(r.min[0],x);r.min[1]=Math.min(r.min[1],y);r.min[2]=Math.min(r.min[2],z);
      r.max[0]=Math.max(r.max[0],x);r.max[1]=Math.max(r.max[1],y);r.max[2]=Math.max(r.max[2],z);
    }
    await yieldControl();
  }
  check();
  const declared=new Map(mask.labels.map(label=>[label.id,label.voxels]));
  for(const id of IDS)if(entries.get(id)!.count!==(declared.get(id)??0))
    throw Error("Данные маски изменились после проверки паспорта.");
  for(let start=0;start<size;start+=CHUNK){
    check();
    for(let i=start;i<Math.min(start+CHUNK,size);i++){
      const id=mask.data[i];if(!id)continue;
      const r=entries.get(id)!;
      const x=i%nx,y=Math.floor(i/nx)%ny,z=Math.floor(i/(nx*ny));
      const dx=x-r.sums[0]/r.count,dy=y-r.sums[1]/r.count,dz=z-r.sums[2]/r.count;
      const distance=dx*dx+dy*dy+dz*dz;
      if(distance<r.closestDistance){
        r.closestDistance=distance;
        r.closest=[x,y,z];
      }
    }
    await yieldControl();
  }
  check();
  return IDS.flatMap(id=>{
    const r=entries.get(id)!;
    if(!r.count)return [];
    const anchor=transformPoint(mask.affineLps,r.closest);
    return [{
      id,name:proof.labelNames[id],voxels:r.count,
      volumeMl:r.count*mask.voxelVolumeMm3/1000,
      boundsMaskIndex:{min:[...r.min] as Point3,max:[...r.max] as Point3},
      originalSliceRange:[proof.firstSlice+r.min[2],proof.firstSlice+r.max[2]] as [number,number],
      anchorMaskIndex:[...r.closest] as Point3,
      anchorLpsMm:anchor,
      status:"unverified_research" as const,
    }];
  });
}
