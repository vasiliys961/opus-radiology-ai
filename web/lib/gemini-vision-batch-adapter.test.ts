import { strict as assert } from "node:assert";
import { createGeminiBatchReviewer } from "./gemini-vision-batch-adapter.ts";
const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5kAAAAASUVORK5CYII=";
const images=[0,1].map(index=>({index,frame:{
  imageId:"frame-"+index,mimeType:"image/png" as const,base64:png,
  seriesUid:"1.2.3",sopInstanceUid:"1.2.3."+index,frameIndex:0,
  slicePositionMm:index,viewLabel:"axial",
}}));
let called=0;
const reviewer=createGeminiBatchReviewer(images,{modality:"CT",regions:["chest"]},{
  provider:"openrouter",visionModel:"gemini-test",call:async request=>{
    called++;
    assert.equal(request.role,"vision");
    assert.match(String(request.messages[0].content),/thoracic/);
    return {usage:{prompt_tokens:210,completion_tokens:40},choices:[{finish_reason:"stop",
      message:{content:JSON.stringify({reviewedImageIds:["frame-0","frame-1"],
        observations:[{id:"nodule",imageId:"frame-0",anatomy:"lung",
          sign:"research candidate",uncertainty:"2D only"}],
        limitations:["incomplete volume"]})}}]};
  },
});
const result=await reviewer({pass:"overview",indices:[0,1]},0);
assert.equal(called,1);
assert.deepEqual(result.reviewedIndices,[0,1]);
assert.equal(result.usage.inputTokens,210);
assert.equal(result.evidence.findings[0].source.sopInstanceUid,"1.2.3.0");
assert.equal(result.evidence.findings[0].status,"requires_recheck");
await assert.rejects(()=>reviewer({pass:"overview",indices:[2]},1));
const invalid=createGeminiBatchReviewer(images,{modality:"CT",regions:["chest"]},{
  provider:"openrouter",visionModel:"gemini-test",call:async()=>({
    usage:{prompt_tokens:9,completion_tokens:3},
    choices:[{finish_reason:"stop",message:{content:JSON.stringify({
      reviewedImageIds:["frame-0","frame-1"],
      observations:[{id:"a",imageId:"unseen",anatomy:"lung",
        sign:"opacity",uncertainty:"uncertain"}],limitations:[]})}}]}),
});
await assert.rejects(()=>invalid({pass:"overview",indices:[0,1]},0));
console.log("PASS provider Gemini batch adapter and DICOM source contract");
