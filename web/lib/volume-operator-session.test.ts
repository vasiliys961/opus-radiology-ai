import test from "node:test";
import assert from "node:assert/strict";
import {localResearchEnabled,localResearchStatus,createVolumeSession,validateVolumeSession}
 from "./volume-operator-session.ts";

const configured={
 NODE_ENV:"development",
 OPENROUTER_API_KEY:"synthetic-public-test-key-no-network-access-0000000000",
 RADIOLOGY_ENABLE_AUTOMATIC_PUBLIC_VOLUME_RESEARCH:"1",
 RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT:"1",
 RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED:"1",
} as const;

test("One-time explicitly approved local research works without a second manual token",()=>{
 const keys=[...Object.keys(configured),"RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN"];
 const previous=new Map(keys.map(key=>[key,process.env[key]]));
 try{
   for(const [key,value] of Object.entries(configured))process.env[key]=value;
   delete process.env.RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN;
   assert.equal(localResearchStatus(),"ready");
   assert.equal(localResearchEnabled(),true);
   const now=Date.now(),session=createVolumeSession(now);
   assert.equal(validateVolumeSession(session,now+1000),true);
   assert.equal(validateVolumeSession(session,now+4*60*60*1000),false);
   assert.equal(validateVolumeSession(session.replace(/.$/,"x"),now),false);

   process.env.RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED="0";
   assert.equal(localResearchEnabled(),false,"No patient/health-data consent bypass");
   process.env.RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED="1";
   (process.env as Record<string,string|undefined>).NODE_ENV="production";
   assert.equal(localResearchEnabled(),false,"No localhost research mode in production");
 }finally{
   for(const [key,value] of previous){
     if(value===undefined)delete process.env[key];else process.env[key]=value;
   }
 }
});

test("Read-only diagnostics do not activate cloud without saved consent",()=>{
 const v={...configured} as Record<string,string>;
 delete v.RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED;
 assert.equal(localResearchStatus(v),"not-approved");
 delete v.OPENROUTER_API_KEY;
 assert.equal(localResearchStatus(v),"missing-provider");
 v.NODE_ENV="production";
 assert.equal(localResearchStatus(v),"not-development");
});
