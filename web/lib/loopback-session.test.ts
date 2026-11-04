import test from "node:test";
import assert from "node:assert/strict";
import {loopbackTokens} from "./loopback-session.ts";
const token="a".repeat(32);
test("a downloaded worker session keeps only named tokens",()=>{
  const parsed=loopbackTokens(JSON.stringify({schema:"opus-loopback-session/v1",workers:{
    OPUS_XRV_WORKER_TOKEN:token,note:"скрытый текст",short:"abc",
  }}));
  assert.deepEqual(parsed,{OPUS_XRV_WORKER_TOKEN:token});
});
test("a broken session yields no token",()=>{
  assert.deepEqual(loopbackTokens("не json"),{});
});
