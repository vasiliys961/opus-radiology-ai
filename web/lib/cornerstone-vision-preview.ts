import {pairReviewWindows} from './review-window-pair';
import {ctReviewWindow,requireCtReviewCalibration,type CtReviewWindow} from './ct-review-window';
import {readDicomSeriesHeader} from './dicom-series';
import {windowDecodedPlane} from './decoded-vision-preview';
/** Bounded compressed-DICOM fallback using the viewer's installed decoder.
 * Never captures the viewport, overlays, identifiers or another cached study. */
export async function decodeCornerstoneVisionPreview(file:File,maxPixels:number,signal:AbortSignal,reviewWindow:CtReviewWindow='SOURCE',additionalWindow?:CtReviewWindow):Promise<string>{
 const header=await readDicomSeriesHeader(file);signal.throwIfAborted();
 requireCtReviewCalibration(header,reviewWindow,additionalWindow);
 if((header.numberOfFrames??1)!==1||!header.rows||!header.columns||header.rows*header.columns>maxPixels)
  throw Error('Для анализа нужен отдельный срез допустимого размера.');
 const [core,loader]=await Promise.all([import('@cornerstonejs/core'),import('@cornerstonejs/dicom-image-loader')]);
 await core.init();await loader.init({maxWebWorkers:1});signal.throwIfAborted();
 const id=loader.wadouri.fileManager.add(file),index=Number(id.split(':').pop());
 const loaded=loader.wadouri.loadImage(id,{preScale:{enabled:false}});
 try{
  const image=await loaded.promise;signal.throwIfAborted();
  if(image.color||image.numberOfComponents!==1&&image.numberOfComponents!==undefined||
    image.width!==header.columns||image.height!==header.rows)throw Error('Неподдерживаемые пиксели DICOM.');
  const first=(v:number|number[]|undefined)=>{const n=Array.isArray(v)?v[0]:v;return typeof n==='number'&&Number.isFinite(n)?n:null;};
  const window=ctReviewWindow(reviewWindow,header.modality);
  let pixels=windowDecodedPlane(image.getPixelData(),image.width,image.height,maxPixels,
    image.preScale?.scaled?1:(image.slope??1),image.preScale?.scaled?0:(image.intercept??0),
    window.center??first(image.windowCenter),window.width??first(image.windowWidth),image.invert===true);
  let outputWidth=image.width;
  if(additionalWindow){
   const extra=ctReviewWindow(additionalWindow,header.modality);
   const right=windowDecodedPlane(image.getPixelData(),image.width,image.height,maxPixels,
    image.preScale?.scaled?1:(image.slope??1),image.preScale?.scaled?0:(image.intercept??0),
    extra.center??first(image.windowCenter),extra.width??first(image.windowWidth),image.invert===true);
   const pair=pairReviewWindows(pixels,right,image.width,image.height,maxPixels);pixels=pair.pixels;outputWidth=pair.width;
  }
  const canvas=document.createElement('canvas');canvas.width=outputWidth;canvas.height=image.height;
  const context=canvas.getContext('2d');if(!context)throw Error('Не удалось подготовить изображение.');
  const data=context.createImageData(outputWidth,image.height);data.data.set(pixels);context.putImageData(data,0,0);
  return canvas.toDataURL('image/png');
 }finally{loaded.decache?.();loader.wadouri.fileManager.remove(index);}
}
