import type {IchSliceEvidenceRow} from "./ich-slice-evidence";

export type IchErrorRun={
 firstSliceIndex:number;lastSliceIndex:number;sliceCount:number;
 totalUnmatchedVoxels:number;peakSliceIndex:number;peakSliceUnmatchedVoxels:number;
};

/** Contiguous native-axis error planes: never interpret as individual lesions. */
export function contiguousIchErrorRuns(
 rows:ReadonlyArray<IchSliceEvidenceRow>,kind:"fn"|"fp"
):IchErrorRun[]{
 const key=kind==="fn"?"falseNegativeVoxels":"falsePositiveVoxels";
 const result:IchErrorRun[]=[];
 let current:IchErrorRun|null=null;
 for(let index=0;index<rows.length;index++){
  const row=rows[index];
  if(row.nativeSliceIndex!==index)throw Error("Unordered native CT indices.");
  const n=row[key];
  if(!Number.isSafeInteger(n)||n<0)throw Error("Invalid error voxel count.");
  if(n===0){if(current){result.push(current);current=null;}continue;}
  if(!current){
   current={firstSliceIndex:index,lastSliceIndex:index,sliceCount:1,
    totalUnmatchedVoxels:n,peakSliceIndex:index,peakSliceUnmatchedVoxels:n};
  }else{
   current.lastSliceIndex=index;current.sliceCount++;
   current.totalUnmatchedVoxels+=n;
   if(n>current.peakSliceUnmatchedVoxels){
    current.peakSliceIndex=index;current.peakSliceUnmatchedVoxels=n;
   }
  }
 }
 if(current)result.push(current);
 return result.sort((a,b)=>b.totalUnmatchedVoxels-a.totalUnmatchedVoxels||
   a.firstSliceIndex-b.firstSliceIndex);
}
