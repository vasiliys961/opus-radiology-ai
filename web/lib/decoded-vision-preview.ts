/** Window a single decoded source plane; no annotations, crop or resizing. */
export function windowDecodedPlane(values:ArrayLike<number>,width:number,height:number,
 maxPixels:number,slope:number,intercept:number,center:number|null,window:number|null,inverse:boolean){
 const count=width*height;
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||
  !Number.isSafeInteger(maxPixels)||maxPixels<1||count>maxPixels||values.length!==count||
  !Number.isFinite(slope)||slope===0||!Number.isFinite(intercept))throw Error('Недопустимый размер или шкала исходного кадра.');
 let low=Infinity,high=-Infinity;
 for(let i=0;i<count;i++){const v=values[i]*slope+intercept;if(!Number.isFinite(v))throw Error('Повреждены пиксели исходного кадра.');low=Math.min(low,v);high=Math.max(high,v);}
 const hasWindow=center!==null&&window!==null&&Number.isFinite(center)&&Number.isFinite(window)&&window>=1;
 if(hasWindow){low=center!-.5-(window!-1)/2;high=center!-.5+(window!-1)/2;}
 const rgba=new Uint8ClampedArray(count*4);
 for(let i=0;i<count;i++){
  const v=values[i]*slope+intercept;
  const grey=high<=low?(hasWindow&&v>center!-.5?255:0):Math.round(Math.max(0,Math.min(255,(v-low)/(high-low)*255)));
  const p=i*4;rgba[p]=rgba[p+1]=rgba[p+2]=inverse?255-grey:grey;rgba[p+3]=255;
 }
 return rgba;
}
