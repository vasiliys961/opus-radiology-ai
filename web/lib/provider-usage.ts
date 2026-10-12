import type {AiProvider} from "./ai-gateway.ts";

export const SYNTHETIC_USAGE_STEPS=["anatomy","observations","quality","critic","synthesis"] as const;
export type UsageStep=typeof SYNTHETIC_USAGE_STEPS[number];
const object=(v:unknown):Record<string,unknown> =>
  v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const count=(v:unknown):number|null => typeof v==="number"&&Number.isSafeInteger(v)&&v>=0?v:null;
const cost=(v:unknown):number|null => typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER?v:null;

/** Explicit numeric allowlist; never serialize raw provider metadata or secrets. */
export function normalizeProviderUsage(provider:AiProvider,value:unknown) {
  const v=object(value),promptTokens=count(v.prompt_tokens),completionTokens=count(v.completion_tokens);
  let totalTokens=count(v.total_tokens);
  if(promptTokens!==null&&completionTokens!==null&&totalTokens!==null&&
      promptTokens+completionTokens!==totalTokens)totalTokens=null;
  const cached=count(object(v.prompt_tokens_details).cached_tokens);
  const reasoning=count(object(v.completion_tokens_details).reasoning_tokens);
  let reportedCost=cost(provider==="polza"&&Object.hasOwn(v,"cost_rub")?v.cost_rub:v.cost);
  if(provider==="polza"&&Object.hasOwn(v,"cost_rub")&&Object.hasOwn(v,"cost")&&cost(v.cost)!==reportedCost)
    reportedCost=null;
  return {promptTokens,completionTokens,totalTokens,
    cachedTokens:cached!==null&&promptTokens!==null&&cached>promptTokens?null:cached,
    reasoningTokens:reasoning!==null&&completionTokens!==null&&reasoning>completionTokens?null:reasoning,
    reportedCost,currency:provider==="polza"?"RUB" as const:"USD" as const};
}
export type ProviderUsageCall=ReturnType<typeof normalizeProviderUsage>&{step:UsageStep;requestedModel:string};
export function summarizeProviderUsage(provider:AiProvider,calls:readonly ProviderUsageCall[]) {
  if(calls.length!==5||calls.some((c,i)=>c.step!==SYNTHETIC_USAGE_STEPS[i]||
      c.currency!==(provider==="polza"?"RUB":"USD")))throw new Error("Invalid usage call ledger");
  const sum=(key:"promptTokens"|"completionTokens"|"totalTokens"|"reportedCost")=>{
    if(calls.some(c=>c[key]===null))return null;
    const value=calls.reduce((n,c)=>n+c[key]!,0);
    return key==="reportedCost"?cost(value):count(value);
  };
  return {schema:"opus-provider-usage/v1" as const,source:"provider-response" as const,
    scope:"completed-trial-only" as const,provider,currency:provider==="polza"?"RUB" as const:"USD" as const,
    calls:[...calls],totals:{promptTokens:sum("promptTokens"),completionTokens:sum("completionTokens"),
      totalTokens:sum("totalTokens"),reportedCost:sum("reportedCost")},
    callsWithReportedCost:calls.filter(c=>c.reportedCost!==null).length};
}
export type ProviderUsageReport=ReturnType<typeof summarizeProviderUsage>;
