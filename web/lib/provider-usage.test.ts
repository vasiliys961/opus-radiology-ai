import test from "node:test";
import assert from "node:assert/strict";
import {normalizeProviderUsage,summarizeProviderUsage,SYNTHETIC_USAGE_STEPS} from "./provider-usage.ts";

test("Provider usage preserves numeric cost/currency and does not double count cache/reasoning",()=>{
  const raw={prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:0.012,
    prompt_tokens_details:{cached_tokens:30},completion_tokens_details:{reasoning_tokens:20}};
  const normalized=normalizeProviderUsage("openrouter",raw);
  assert.deepEqual(normalized,{promptTokens:100,completionTokens:50,totalTokens:150,
    cachedTokens:30,reasoningTokens:20,reportedCost:0.012,currency:"USD"});
  assert.equal(normalizeProviderUsage("polza",{...raw,cost_rub:0.012}).currency,"RUB");
  assert.equal(normalizeProviderUsage("polza",{cost_rub:1.25}).reportedCost,1.25);
  const calls=SYNTHETIC_USAGE_STEPS.map(step=>({step,requestedModel:"fixture",...normalized}));
  const summary=summarizeProviderUsage("openrouter",calls);
  assert.deepEqual(summary.totals,{promptTokens:500,completionTokens:250,totalTokens:750,reportedCost:0.06});
  assert.equal(summary.callsWithReportedCost,5);
});
test("Absent/malformed/partial usage is unknown rather than zero/free or a fabricated total",()=>{
  for(const value of [null,undefined,[],"usage",{cost:"0.01",prompt_tokens:-1,completion_tokens:0.5,total_tokens:Infinity},
    {cost:NaN,prompt_tokens:Number.MAX_SAFE_INTEGER+1}]) {
    const row=normalizeProviderUsage("openrouter",value);
    assert.equal(row.reportedCost,null);assert.equal(row.promptTokens,null);
  }
  assert.equal(normalizeProviderUsage("openrouter",{cost:0}).reportedCost,0);
  assert.equal(normalizeProviderUsage("openrouter",{prompt_tokens:10,completion_tokens:5}).totalTokens,null);
  const invalid=normalizeProviderUsage("polza",{cost_rub:2,cost:3,prompt_tokens:10,completion_tokens:5,total_tokens:999,
    prompt_tokens_details:{cached_tokens:11},completion_tokens_details:{reasoning_tokens:6}});
  assert.equal(invalid.reportedCost,null);assert.equal(invalid.totalTokens,null);
  assert.equal(invalid.cachedTokens,null);assert.equal(invalid.reasoningTokens,null);
  const calls=SYNTHETIC_USAGE_STEPS.map((step,i)=>({step,requestedModel:"fixture",
    ...normalizeProviderUsage("openrouter",i===0?{}:{cost:0,prompt_tokens:1,completion_tokens:1,total_tokens:2})}));
  const report=summarizeProviderUsage("openrouter",calls);
  assert.equal(report.totals.reportedCost,null);assert.equal(report.totals.totalTokens,null);
  assert.equal(report.callsWithReportedCost,4);
  assert.throws(()=>summarizeProviderUsage("polza",calls),/Invalid/);
  assert.throws(()=>summarizeProviderUsage("openrouter",calls.slice(1)),/Invalid/);
});
test("Usage export reads only approved numeric fields and rejects overflowing sums",()=>{
  const raw={cost:1,prompt_tokens:Number.MAX_SAFE_INTEGER,completion_tokens:0,
    total_tokens:Number.MAX_SAFE_INTEGER,
    get apiKey(){throw Error("secret must not be read");},get patientName(){throw Error("PHI must not be read");},
    prompt_tokens_details:{get text(){throw Error("text must not be read");}}};
  const row=normalizeProviderUsage("openrouter",raw);
  const report=summarizeProviderUsage("openrouter",SYNTHETIC_USAGE_STEPS.map(step=>({step,requestedModel:"fixture",...row})));
  assert.equal(report.totals.promptTokens,null);assert.equal(report.totals.totalTokens,null);
  assert.equal(report.totals.reportedCost,5);assert.equal(JSON.stringify(report).includes("patientName"),false);
});
