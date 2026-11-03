/** Two source-grid VOI views side by side; no resampling, crop or annotations. */
export function pairReviewWindows(left:Uint8ClampedArray,right:Uint8ClampedArray,width:number,height:number,maxPixels:number){
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||
 width*height*2>maxPixels||left.length!==width*height*4||right.length!==left.length)throw Error('Два окна не помещаются в допустимый размер копии.');
 const pixels=new Uint8ClampedArray(width*height*8),row=width*4;
 for(let y=0;y<height;y++){pixels.set(left.subarray(y*row,(y+1)*row),y*row*2);pixels.set(right.subarray(y*row,(y+1)*row),(y*2+1)*row);}
 return {pixels,width:width*2,height};
}
