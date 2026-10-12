"use client";
import { useState } from "react";
import { buildEvidenceReport } from "../lib/evidence-report";
import type { SegmentationEvidence } from "../lib/segmentation-evidence";
import type { LlmMeasurements } from "../lib/evidence-reconciliation";
import type { Point3 } from "../lib/segmentation-mask";

export default function EvidenceReportDownload({evidence,llm,onSampleMask}: {
  evidence: SegmentationEvidence; llm?: LlmMeasurements | null; onSampleMask?: (point: Point3)=>number | null;
}) {
  const [error,setError]=useState("");
  const download=()=>{
    try {
      const html=buildEvidenceReport(evidence,{llm,sampleMask:onSampleMask,generatedAt:new Date().toISOString()});
      const url=URL.createObjectURL(new Blob([html],{type:"text/html;charset=utf-8"}));
      const a=document.createElement("a");a.href=url;a.download=`opus-${evidence.source.requestId}.${llm?"comparison":"evidence"}.report.html`;
      document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);setError("");
    }catch(e){setError(e instanceof Error?e.message:"Не удалось создать отчёт Evidence.");}
  };
  return <div className="ora-report-export">
    <button type="button" onClick={download}>{llm?"Скачать отчёт с сопоставлением HTML":"Скачать отчёт Evidence HTML"}</button>
    <small>Откройте файл локально; печать или сохранение PDF доступны через меню браузера. Отчёт — неподписанный черновик.</small>
    {error&&<p role="alert" className="ora-evidence-error">{error}</p>}
  </div>;
}
