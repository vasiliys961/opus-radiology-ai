/** Real dev handlers, no valid image/provider payload and no paid model calls. */
import assert from 'node:assert/strict';
const base=process.env.OPUS_TEST_BASE_URL??'http://localhost:3000';
assert.match(base,/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/);
const readiness=await fetch(base+'/api/ai/deidentified-openrouter-review');
assert.equal(readiness.status,200);
const data=await readiness.json();assert.equal(data.workstationConnected,true,'Preapproved reviewed-frame local session required');
const set=readiness.headers.get('set-cookie')??'';
assert.match(set,/path=\/api\/ai;/i);
const cookie=set.split(';')[0];
for(const path of ['approved-volume-gemini-batch','complete-volume-opus']){
 const headers={origin:base,'sec-fetch-site':'same-origin','x-opus-reviewed-volume':'1','content-type':'text/plain'};
 const allowed=await fetch(base+'/api/ai/'+path,{method:'POST',headers:{...headers,cookie},body:'invalid-no-images-no-model-call'});
 assert.equal(allowed.status,415,path+' must validate payload only after signed session');
 const denied=await fetch(base+'/api/ai/'+path,{method:'POST',headers,body:'invalid'});
 assert.equal(denied.status,path==='approved-volume-gemini-batch'?401:404);
 const cross=await fetch(base+'/api/ai/'+path,{method:'POST',headers:{...headers,cookie,origin:'https://untrusted.example'},body:'invalid'});
 assert.equal(cross.status,404);
}
const publicAuto=await fetch(base+'/api/ai/approved-volume-gemini-batch',{method:'POST',
 headers:{cookie,origin:base,'x-opus-auto-public-volume':'1','content-type':'text/plain'},body:'invalid'});
assert.equal(publicAuto.status,503,'Reviewed-frame session must not activate public auto-OCR mode');
const unreviewedText=await fetch(base+'/api/ai/complete-volume-opus',{method:'POST',headers:{cookie,origin:base,'x-opus-reviewed-volume':'1','content-type':'application/json'},body:JSON.stringify({mode:'discuss',report:'Synthetic',coverage:'1/9',clinicalContext:'',question:'Test?',history:[],acknowledgeReviewedText:false})});
assert.equal(unreviewedText.status,400,'New discussion must reject unreviewed text before any paid call');
console.log('PASS actual local signed-session batch/final routes: malformed payload 415, missing session denied, cross-origin denied, public auto mode remains disabled. Zero model calls.');
