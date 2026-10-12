import { createPrivacyFrame,MAX_REDACTIONS,pngFromBase64,validatePrivacyRectangle,type PrivacyFrame,type PrivacyRectangle } from "./vision-privacy.ts";

/** Apply black pixels to the outgoing raster itself, not a CSS/viewer overlay. */
export async function redactPrivacyFrame(frame:PrivacyFrame,rectangle:PrivacyRectangle):Promise<PrivacyFrame> {
  if(frame.redactions.length>=MAX_REDACTIONS)throw new Error("Достигнут лимит 32 областей скрытия.");
  const clean=createPrivacyFrame(pngFromBase64(frame.pngBase64),frame.frameId,frame.modality,frame.redactions);
  if(clean.sha256!==frame.sha256||clean.width!==frame.width||clean.height!==frame.height)throw new Error("Размер или SHA копии изменился.");
  const r=validatePrivacyRectangle(rectangle,frame.width,frame.height);
  const image=new Image();
  image.src="data:image/png;base64,"+clean.pngBase64;await image.decode();
  if(image.naturalWidth!==frame.width||image.naturalHeight!==frame.height)throw new Error("Размер копии изменился.");
  const canvas=document.createElement("canvas");canvas.width=frame.width;canvas.height=frame.height;
  try{
    const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Не удалось подготовить копию.");
    ctx.drawImage(image,0,0);ctx.fillStyle="#000";ctx.fillRect(r.x,r.y,r.width,r.height);
    return createPrivacyFrame(pngFromBase64(canvas.toDataURL("image/png").split(",")[1]),frame.frameId,frame.modality,[...frame.redactions,r]);
  }finally{canvas.width=0;canvas.height=0;image.src="";}
}
