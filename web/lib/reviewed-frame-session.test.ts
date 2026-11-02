import test from "node:test";
import assert from "node:assert/strict";
import {reviewedFrameSessionEnabled,createReviewedFrameSession,validReviewedFrameSession}
 from "./reviewed-frame-session.ts";
const env={NODE_ENV:"development",OPENROUTER_API_KEY:"synthetic-not-a-real-provider-key",
 RADIOLOGY_LOCAL_REVIEWED_FRAME_SESSION:"1",
 RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT:"1",
 RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED:"1"};
const now=1_793_600_000_000;
test("Reviewed PNG session needs separate explicit approval, not a public-study claim",()=>{
 assert.equal(reviewedFrameSessionEnabled(env),true);
 const session=createReviewedFrameSession(env,now);
 assert.equal(validReviewedFrameSession(session,env,now+1000),true);
 assert.equal(validReviewedFrameSession(session,env,now+4*60*60*1000),false);
 assert.equal(validReviewedFrameSession(session,env,now-1),false);
 const last=session.endsWith("0")?"1":"0";
 assert.equal(validReviewedFrameSession(session.slice(0,-1)+last,env,now),false);
 assert.equal(validReviewedFrameSession(session.replace("reviewed-v1","v1"),env,now),false);
 for(const key of Object.keys(env)){
  assert.equal(validReviewedFrameSession(session,{...env,[key]:""},now),false,key);
 }
 assert.equal(validReviewedFrameSession(session,{...env,NODE_ENV:"production"},now),false);
 assert.equal(validReviewedFrameSession(session,{...env,OPENROUTER_API_KEY:"rotated"},now),false);
 assert.throws(()=>createReviewedFrameSession({...env,RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED:"0"},now));
});
