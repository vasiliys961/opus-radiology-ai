/**
 * Research CT intensity windowing for PUBLIC normalized and native NIfTI.
 * Adaptive contrast is NOT a HU conversion or diagnostic attenuation score.
 */
export type ResearchWindow={center:number;width:number;mode:"auto"|"fixed"};

export function automaticCtWindow(pixels:Float32Array):ResearchWindow{
 if(pixels.length<1||pixels.length>512*512)
   throw Error("Unsupported native CT slice for automatic window.");
 const step=Math.max(1,Math.ceil(pixels.length/32768));
 const sampled:number[]=[];
 for(let i=0;i<pixels.length;i+=step){
   const v=pixels[i];
   if(!Number.isFinite(v))throw Error("Non-finite CT intensity.");
   sampled.push(v);
 }
 sampled.sort((a,b)=>a-b);
 const at=(fraction:number)=>sampled[Math.floor((sampled.length-1)*fraction)];
 const low=at(.01),high=at(.99);
 if(!Number.isFinite(low)||!Number.isFinite(high))
    throw Error("Invalid source intensity distribution.");
 const width=high-low;
 if(width<=0)return {center:sampled[0],width:1,mode:"auto"};
 return {center:(low+high)/2,width,mode:"auto"};
}

export function grayscaleCt(value:number,window:Pick<ResearchWindow,"center"|"width">):number{
 if(!Number.isFinite(value)||!Number.isFinite(window.center)||
    !Number.isFinite(window.width)||window.width<=0)
    throw Error("Invalid research CT window.");
 const low=window.center-window.width/2;
 return Math.round(255*Math.max(0,Math.min(1,(value-low)/window.width)));
}
