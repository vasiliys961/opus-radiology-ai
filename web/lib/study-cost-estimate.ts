import {GEMINI_INPUT_RATE_USD_PER_M,GEMINI_OUTPUT_RATE_USD_PER_M,type LocalVolumeReceipt} from './full-volume-receipts.ts';
// Public OpenRouter standard prices checked 2026-11-03; routing/cache/reasoning can change actual billing.
// https://openrouter.ai/google/gemini-3.8-flash
// https://openrouter.ai/anthropic/claude-opus-5.5
export const OPUS_INPUT_USD_PER_M=4,OPUS_OUTPUT_USD_PER_M=20;
export function opusUsageEstimate(usage:{inputTokens:number;outputTokens:number}){
 return (usage.inputTokens*OPUS_INPUT_USD_PER_M+usage.outputTokens*OPUS_OUTPUT_USD_PER_M)/1e6;
}
export function estimateStudyCost(frames:number,batches:number,receipts:readonly LocalVolumeReceipt[],reviewed:number,visual:boolean){
 const spent=receipts.reduce((n,r)=>n+(r.usage.inputTokens*GEMINI_INPUT_RATE_USD_PER_M+r.usage.outputTokens*GEMINI_OUTPUT_RATE_USD_PER_M)/1e6,0);
 const gemini=reviewed>0?spent*frames/reviewed:(frames*2500*GEMINI_INPUT_RATE_USD_PER_M+batches*3500*GEMINI_OUTPUT_RATE_USD_PER_M)/1e6;
 // Planning assumptions, not measured usage: 3 concise findings per batch,
 // source-bound reconciliation context, up to 3500 output tokens per Opus call.
 const opus=opusUsageEstimate({inputTokens:6000+batches*700,outputTokens:3500})+
  (visual?opusUsageEstimate({inputTokens:2000+Math.min(16,frames)*1800,outputTokens:3500}):0);
 return {gemini,opus,total:gemini+opus};
}
