/**
 * AI model capability registry v1.7. Catalog entries are candidates, not promises
 * of real-time provider availability or clinical diagnostic performance.
 */
export type ProviderId = "openrouter" | "polza";
export type SegmentationId = "totalsegmentator" | "nv-segment-ctmr";
export type PipelineRole = "vision" | "clinical" | "segmentation" | "roi-segmentation";
export type CatalogEntry = {
  id: string; label: string; role: PipelineRole; engine: "api" | "inference-worker";
  status: "configured-candidate" | "research" | "not-connected" | "deferred";
  modality: readonly ("CT" | "MR")[];
  notes: string;
  weightsLicence?: string;
};
export const AI_CATALOG: readonly CatalogEntry[] = [
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", role: "vision", engine: "api", status: "configured-candidate", modality: ["CT", "MR"], notes: "Глаза оркестра: анализ подготовленных изображений, не исходного DICOM-объёма" },
  { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", role: "clinical", engine: "api", status: "configured-candidate", modality: ["CT", "MR"], notes: "Синтез структурированных находок, требует проверки врачом" },
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", role: "clinical", engine: "api", status: "configured-candidate", modality: ["CT", "MR"], notes: "Альтернативная модель клинического синтеза" },
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", role: "clinical", engine: "api", status: "configured-candidate", modality: ["CT", "MR"], notes: "Углублённая проверка сложных случаев" },
  { id: "totalsegmentator", label: "TotalSegmentator", role: "segmentation", engine: "inference-worker", status: "not-connected", modality: ["CT", "MR"], notes: "Основной кандидат для анатомической сегментации; профиль и задача выбираются отдельно для КТ/МРТ", weightsLicence: "Проверять лицензию конкретной задачи и весов; базовые задачи Apache-2.0" },
  { id: "nv-segment-ctmr", label: "NV-Segment-CTMR", role: "segmentation", engine: "inference-worker", status: "research", modality: ["CT", "MR"], notes: "Исследовательский сравнительный кандидат; не подключён", weightsLicence: "Некоммерческое исследование/оценка — требуется проверка условий" },
  { id: "medsam2", label: "MedSAM2 / Efficient MedSAM2", role: "roi-segmentation", engine: "inference-worker", status: "deferred", modality: ["CT", "MR"], notes: "Опциональная ROI-сегментация после отдельной проверки памяти, скорости и лицензии. Нет автоматической загрузки весов; не входит в основной конвейер v1.7." },
];
export function defaultModelFor(role: "vision" | "clinical"): string {
  const result = AI_CATALOG.find(m => m.role === role && m.status === "configured-candidate");
  if (!result) throw new Error("No candidate configured for role");
  return result.id;
}
export function modelsForRole(role: PipelineRole): readonly CatalogEntry[] {
  return AI_CATALOG.filter(m => m.role === role);
}
/** Selection is explicit; provider never changes silently due to assumed region. */
export function changeProvider(_current: ProviderId, selected: ProviderId): ProviderId {
  if (selected !== "polza" && selected !== "openrouter") throw new Error("Invalid provider");
  return selected;
}
