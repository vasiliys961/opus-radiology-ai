import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceReport } from "./evidence-report.ts";
import { changeEvidenceReview, startEvidenceReview } from "./evidence-review-history.ts";
import { createLlmMeasurementTemplate } from "./evidence-reconciliation.ts";
import type { SegmentationEvidence } from "./segmentation-evidence.ts";

const geometry: SegmentationEvidence["mask"]["geometry"]={dimensions:[2,2,2],affineLps:[1,0,0,0,0,1,0,0,0,0,1,0]};
const base: SegmentationEvidence={schema:"opus-specialist-evidence/v1",clinicalStatus:"unverified_research_draft",
  producer:{kind:"specialist-model",executionMode:"local",model:{id:"synthetic-fixture",version:"1",weightsSha256:"a".repeat(64),modality:"CT",task:"synthetic-only"}},
  source:{requestId:"report-fixture",sourceIdentitySha256:"b".repeat(64),inputSha256:"c".repeat(64),frameCount:2,modality:"CT",scope:"selected-series-only",coverage:"not-confirmed",geometry},
  mask:{sha256:"d".repeat(64),geometry},limitations:["Synthetic only; not clinical evidence"],
  observations:[{observationId:"report-fixture:label:1",kind:"segmentation-measurement",labelId:1,labelName:"Synthetic label",voxels:4,volumeMl:0.004,
    boundsMaskIndex:{min:[0,0,0],max:[1,1,1]},anchorLpsMm:[0,0,0],review:"unreviewed"}]};
const generatedAt="2026-10-12T06:00:00.000Z";
function claims() {
  const l=createLlmMeasurementTemplate(base);l.producer={kind:"llm",provider:"synthetic-fixture",model:"no-LLM-called"};
  l.claims[0]={...l.claims[0],scope:"loaded-slices",valueMl:0.006,statement:"Synthetic numeric hypothesis",anchor:{coordinateSystem:"LPS-mm",pointLpsMm:[0,0,0],maskSha256:base.mask.sha256}};
  return l;
}

test("report separates measurements, unverified hypotheses and review; preserves hashes and exact differences",t=>{
  t.mock.method(globalThis,"fetch",async()=>{throw Error("Report must stay local");});
  const reviewed=changeEvidenceReview(startEvidenceReview(base),base.observations[0].observationId,"requires_recheck",generatedAt);
  const before=JSON.stringify(reviewed),html=buildEvidenceReport(reviewed,{llm:claims(),sampleMask:()=>1,generatedAt});
  for(const s of ["Измерения по маске","Гипотезы LLM и сопоставление","Локальная история проверки","НЕУТВЕРЖДЁННЫЙ", "0.004","0.006","0.002","На перепроверку",base.source.inputSha256,base.mask.sha256,base.producer.model.weightsSha256]) assert.ok(html.includes(s),s);
  assert.match(html,/В точке целевая метка/);assert.match(html,/Версия 1/);
  assert.match(html,/автор и время не удостоверены/);assert.match(html,/полнота органа не подтверждена/);
  assert.equal(JSON.stringify(reviewed),before);
});

test("empty labels, absent hypotheses/history and zero claims never become normal findings or invented measurements",()=>{
  const html=buildEvidenceReport({...base,observations:[]},{generatedAt});
  assert.match(html,/Ненулевых меток нет[\s\S]*не отрицательное/);
  assert.match(html,/Гипотезы LLM не импортированы/);assert.match(html,/История проверки не предоставлена/);
  const l=claims();l.claims[0].valueMl=0;
  const zero=buildEvidenceReport(base,{llm:l,generatedAt});
  assert.match(zero,/<td>0<\/td>/);assert.match(zero,/-0.004/);assert.match(zero,/Метка не проверена/);
  l.claims[0].valueMl=null;
  assert.match(buildEvidenceReport(base,{llm:l,generatedAt}),/отсутствует числовой объём/);
});

test("wrong source, unsupported/full-organ claims and rejected targets remain visible with abstention",()=>{
  const l=claims();l.source.inputSha256="f".repeat(64);l.claims[0].scope="full-organ";l.claims[0].metric="other";
  const html=buildEvidenceReport(base,{llm:l,generatedAt});
  assert.match(html,/Нельзя сопоставить/);assert.match(html,/Не совпадают пакет/);
  assert.match(html,/Объём полного органа/);assert.match(html,/Привязка точки не подтверждена/);
  assert.ok(html.includes("f".repeat(64))); // retain supplied mismatched binding, never silently replace it
  const reviewed=changeEvidenceReview(startEvidenceReview(base),base.observations[0].observationId,"rejected",generatedAt);
  assert.match(buildEvidenceReport(reviewed,{llm:claims(),generatedAt}),/Отклонено локально/);
  assert.match(buildEvidenceReport(reviewed,{llm:claims(),generatedAt}),/Целевая метка отклонена/);
});

test("readable numeric formatting never turns a small raw discrepancy into agreement",()=>{
  const l=claims();l.claims[0].valueMl=0.004+1e-10;
  const html=buildEvidenceReport(base,{llm:l,generatedAt});
  assert.match(html,/Числовое расхождение/);assert.match(html,/1e-10/);
  assert.match(html,/6 значащих цифр/);
  const noisy={...base,observations:base.observations.map(o=>({...o,volumeMl:0.9400000000000001}))};
  assert.doesNotMatch(buildEvidenceReport(noisy,{generatedAt}),/0\.9400000000000001/);
});

test("spatial report preserves declared point and distinguishes outside, unavailable, background and different label",()=>{
  for(const [label,text] of [[null,"Метка не проверена"],[0,"Фон маски"],[2,"В точке другая метка"]] as const)
    assert.ok(buildEvidenceReport(base,{llm:claims(),sampleMask:()=>label,generatedAt}).includes(text));
  const l=claims();l.claims[0].anchor!.pointLpsMm=[100,100,100];
  const html=buildEvidenceReport(base,{llm:l,generatedAt});
  assert.match(html,/100; 100; 100/);assert.match(html,/Точка за пределами объёма/);
  l.claims[0].anchor!.maskSha256="e".repeat(64);
  assert.match(buildEvidenceReport(base,{llm:l,generatedAt}),/другой маске/);
});

test("report escapes all imported text and carries a no-network/no-script policy with print CSS",()=>{
  const attack='<script src="https://example.invalid/x">alert(1)</script><img src=x onerror="alert(2)">&\'';
  const e={...base,producer:{...base.producer,model:{...base.producer.model,id:attack,task:attack}},
    observations:base.observations.map(o=>({...o,labelName:attack})),limitations:[attack]};
  const l=claims();l.producer.provider=attack;l.producer.model=attack;l.claims[0].statement=attack;
  const html=buildEvidenceReport(e,{llm:l,generatedAt});
  assert.doesNotMatch(html,/<script|<img|<iframe|<link|<form|<a\s/i);
  assert.match(html,/&lt;script src=&quot;/);assert.match(html,/&amp;&#39;/);
  assert.match(html,/default-src 'none'/);assert.match(html,/form-action 'none'/);assert.match(html,/@media print/);
  assert.match(html,/no-referrer/);assert.match(html,/без подписи/);
});

test("allowlisting never serializes opaque buffers/secrets, including throwing unknown getters",()=>{
  const e=startEvidenceReview(structuredClone(base)),l=claims();
  for(const obj of [e,e.reviewHistory,e.reviewHistory.binding,e.producer,l,l.producer,l.source,l.claims[0]])
    Object.defineProperty(obj,"opaqueImage",{enumerable:true,get(){throw Error("Must not read or serialize opaque data");}});
  const html=buildEvidenceReport(e,{llm:l,generatedAt});
  assert.doesNotMatch(html,/opaqueImage|Uint16Array/);
  const raw={...base,patientName:"PHI-sentinel",token:"secret-sentinel",rawDicom:"secret-sentinel"};
  assert.doesNotMatch(buildEvidenceReport(raw,{generatedAt}),/PHI-sentinel|secret-sentinel|rawDicom/);
});

test("inconsistent history, promoted clinical status, malformed time and oversized report fail explicitly",()=>{
  const e=changeEvidenceReview(startEvidenceReview(base),base.observations[0].observationId,"rejected",generatedAt);
  const inconsistent={...e,observations:base.observations};
  assert.throws(()=>buildEvidenceReport(inconsistent,{generatedAt}),/не соответствуют истории/);
  const wrong=structuredClone(e);wrong.reviewHistory.binding.maskSha256="f".repeat(64);
  assert.throws(()=>buildEvidenceReport(wrong,{generatedAt}),/другому пакету/);
  assert.throws(()=>buildEvidenceReport({...base,clinicalStatus:"signed" as never},{generatedAt}));
  assert.throws(()=>buildEvidenceReport(base,{generatedAt:"yesterday"}));
  const oversized={...base,observations:Array.from({length:256},(_,i)=>({...base.observations[0],labelId:i+1,labelName:"&".repeat(8_000)}))};
  assert.throws(()=>buildEvidenceReport(oversized,{generatedAt}),/2 МиБ/);
  assert.throws(()=>buildEvidenceReport({...base,observations:base.observations.map(o=>({...o,volumeMl:NaN}))},{generatedAt}));
});
