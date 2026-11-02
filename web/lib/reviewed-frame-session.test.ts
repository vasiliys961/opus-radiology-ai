import test from "node:test";
import assert from "node:assert/strict";
import {reviewedFrameSessionEnabled,createReviewedFrameSession,validReviewedFrameSession,reviewedFrameConnectionStatus}
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
test("Connection diagnostics distinguish missing credentials, processing approval and manual-only setup",()=>{
 assert.equal(reviewedFrameConnectionStatus(env),"ready");
 assert.equal(reviewedFrameConnectionStatus({...env,NODE_ENV:"production"}),"not-development");
 assert.equal(reviewedFrameConnectionStatus({...env,OPENROUTER_API_KEY:" "}),"missing-provider");
 assert.equal(reviewedFrameConnectionStatus({...env,RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED:"0"}),"not-approved");
 assert.equal(reviewedFrameConnectionStatus({...env,RADIOLOGY_LOCAL_REVIEWED_FRAME_SESSION:"0"}),"operator-required");
 const manual={...env,RADIOLOGY_LOCAL_REVIEWED_FRAME_SESSION:"0",RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN:"x".repeat(32)};
 assert.equal(reviewedFrameConnectionStatus(manual),"ready");
 assert.equal(reviewedFrameSessionEnabled(manual),false,"Manual access does not silently enable automatic sessions");
});
