import type {PlaneReader} from "./full-ct-stream";

/** One owned decoder dataset per call, no volume and no image-cache registration. */
export async function createFullCtReader(files:readonly File[]):Promise<PlaneReader> {
  const core=await import("@cornerstonejs/core"),loader=await import("@cornerstonejs/dicom-image-loader");
  await core.init();await loader.init({maxWebWorkers:1});
  return async(index,signal)=>{
    if(signal.aborted)throw new DOMException("Отменено.","AbortError");
    const imageId=loader.wadouri.fileManager.add(files[index]),registered=Number(imageId.split(":").pop());
    const load=loader.wadouri.loadImage(imageId,{preScale:{enabled:false}});
    let released=false;
    const release=()=>{if(!released){released=true;load.decache?.();loader.wadouri.fileManager.remove(registered);}};
    try {
      const image=await load.promise;
      if(signal.aborted){release();throw new DOMException("Отменено.","AbortError");}
      if(image.color||image.numberOfComponents!==1&&image.numberOfComponents!==undefined)throw new Error("Нужен скалярный КТ-срез.");
      const lut=core.metaData.get("modalityLutModule",imageId) as {rescaleSlope?:number;rescaleIntercept?:number}|undefined;
      return{values:image.getPixelData(),slope:image.preScale?.scaled?1:(lut?.rescaleSlope??image.slope),
        intercept:image.preScale?.scaled?0:(lut?.rescaleIntercept??image.intercept),release};
    }catch(e){release();throw e;}
  };
}
