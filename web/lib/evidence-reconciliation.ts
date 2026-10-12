/** Local metadata comparison. Imported LLM provenance/coverage is a declaration,
 * never proof of inference, independence, clinical agreement or full coverage. */
import type { SegmentationEvidence } from "./segmentation-evidence.ts";
import { invertAffine, transformPoint, type Point3 } from "./segmentation-mask.ts";
import { insideImageExtent } from "./mpr-navigation.ts";

export type LlmAnchor = { coordinateSystem: "LPS-mm"; pointLpsMm: Point3; maskSha256: string };

export const MAX_LLM_MEASUREMENTS_BYTES = 512_000;
export type LlmMeasurements = {
  schema: "opus-llm-measurements/v1";
  clinicalStatus: "unverified_research_draft";
  producer: { kind: "llm"; provider: string; model: string };
  source: Pick<SegmentationEvidence["source"], "requestId" | "sourceIdentitySha256" | "inputSha256" | "frameCount" | "modality">;
  claims: {
    claimId: string;
    observationId: string;
    modelWeightsSha256: string;
    metric: "label-volume-ml" | "other";
    scope: "loaded-slices" | "full-organ" | "unknown";
    valueMl: number | null;
    statement: string;
    anchor?: LlmAnchor | null;
  }[];
};
export type ComparisonReason = "source_binding_mismatch" | "scope_mismatch" | "unsupported_metric" |
  "target_mismatch" | "label_unavailable" | "missing_value" | "specialist_rejected";
export const COMPARISON_REASONS: Record<ComparisonReason, string> = {
  source_binding_mismatch: "Не совпадают пакет, SHA источника/входа, модальность или число срезов.",
  scope_mismatch: "Объём полного органа или неизвестный охват нельзя сравнивать с загруженными срезами.",
  unsupported_metric: "Эта гипотеза не является измерением объёма метки; сегментация анатомии не подтверждает патологию.",
  target_mismatch: "Не совпадает SHA весов целевой специализированной модели.",
  label_unavailable: "Целевая метка отсутствует в этом Evidence; это не отрицательное заключение.",
  missing_value: "В гипотезе отсутствует числовой объём в мл.",
  specialist_rejected: "Целевая метка отклонена локально; сравнение требует перепроверки.",
};
export type EvidenceComparison = {
  claimId: string;
  observationId: string;
  status: "numeric_match" | "numeric_difference" | "not_comparable";
  review: "needs_review";
  specialistVolumeMl: number | null;
  llmVolumeMl: number | null;
  deltaMl: number | null; // LLM minus specialist, no clinical tolerance invented.
  reasons: ComparisonReason[];
  spatial: AnchorCheck | null;
};
export type AnchorCheck = {
  status: "not_bound" | "outside_volume" | "in_volume";
  pointLpsMm: Point3 | null;
  sourceIndex: Point3 | null;
  sampledLabelId: number | null;
  relation: "target_label" | "background" | "different_label" | "not_checked";
  reasons: string[];
  review: "needs_review";
};

const object = (x: unknown): Record<string, unknown> => {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("Некорректный объект гипотез LLM.");
  return x as Record<string, unknown>;
};
const text = (x: unknown, max: number): string => {
  if (typeof x !== "string" || !x.trim() || x.length > max) throw new Error("Некорректное текстовое поле гипотез LLM.");
  return x;
};
const hash = (x: unknown): string => {
  if (typeof x !== "string" || !/^[a-f0-9]{64}$/.test(x)) throw new Error("Некорректный SHA-256 гипотез LLM.");
  return x;
};

/** Allowlisted snapshot: unknown PHI/token/base64 fields are not retained. */
export function parseLlmMeasurements(raw: string): LlmMeasurements {
  if (new TextEncoder().encode(raw).byteLength > MAX_LLM_MEASUREMENTS_BYTES) throw new Error("JSON гипотез слишком большой (максимум 512 КБ).");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Файл не содержит корректный JSON."); }
  const r = object(value);
  if (r.schema === "opus-orchestra/v1" || r.schema === "opus-evidence/v1")
    throw new Error("Этот LLM-паспорт не содержит SHA входа, целевой метки и сопоставимого охвата. Используйте просмотр AI-находок; для сравнения нужен opus-llm-measurements/v1.");
  if (r.schema !== "opus-llm-measurements/v1" || r.clinicalStatus !== "unverified_research_draft")
    throw new Error("Неподдерживаемый контракт гипотез LLM.");
  const p = object(r.producer), s = object(r.source);
  if (p.kind !== "llm" || (s.modality !== "CT" && s.modality !== "MR") ||
    typeof s.frameCount !== "number" || !Number.isSafeInteger(s.frameCount) || s.frameCount < 1 ||
    !Array.isArray(r.claims) || r.claims.length < 1 || r.claims.length > 100)
    throw new Error("Некорректный источник или список гипотез LLM.");
  const ids = new Set<string>();
  const claims = r.claims.map(value => {
    const c = object(value), claimId = text(c.claimId, 160);
    if (ids.has(claimId) || (c.metric !== "label-volume-ml" && c.metric !== "other") ||
      (c.scope !== "loaded-slices" && c.scope !== "full-organ" && c.scope !== "unknown") ||
      !(c.valueMl === null || (typeof c.valueMl === "number" && Number.isFinite(c.valueMl) && c.valueMl >= 0)))
      throw new Error("Повторная или некорректная гипотеза LLM.");
    ids.add(claimId);
    let anchor: LlmAnchor | null | undefined;
    if (c.anchor === null) anchor = null;
    else if (c.anchor !== undefined) {
      const a = object(c.anchor);
      if (a.coordinateSystem !== "LPS-mm" || !Array.isArray(a.pointLpsMm) || a.pointLpsMm.length !== 3 ||
        !a.pointLpsMm.every(v => typeof v === "number" && Number.isFinite(v)))
        throw new Error("Точка гипотезы должна содержать три конечные координаты LPS в мм.");
      anchor = {coordinateSystem: "LPS-mm", pointLpsMm: [...a.pointLpsMm] as Point3, maskSha256: hash(a.maskSha256)};
    }
    return {claimId, observationId: text(c.observationId, 200), modelWeightsSha256: hash(c.modelWeightsSha256),
      metric: c.metric as LlmMeasurements["claims"][number]["metric"],
      scope: c.scope as LlmMeasurements["claims"][number]["scope"], valueMl: c.valueMl as number | null,
      statement: text(c.statement, 2000), ...(anchor === undefined ? {} : {anchor})};
  });
  return {schema: "opus-llm-measurements/v1", clinicalStatus: "unverified_research_draft",
    producer: {kind: "llm", provider: text(p.provider, 160), model: text(p.model, 160)},
    source: {requestId: text(s.requestId, 120), sourceIdentitySha256: hash(s.sourceIdentitySha256),
      inputSha256: hash(s.inputSha256), frameCount: s.frameCount, modality: s.modality as "CT" | "MR"}, claims};
}

/** Template has no prediction or assumed coverage. Filling it is a declaration,
 * not proof the named provider analysed these pixels. Keep export local. */
export function createLlmMeasurementTemplate(evidence: SegmentationEvidence): LlmMeasurements {
  const s = evidence.source;
  return {schema: "opus-llm-measurements/v1", clinicalStatus: "unverified_research_draft",
    producer: {kind: "llm", provider: "not-recorded", model: "not-recorded"},
    source: {requestId: s.requestId, sourceIdentitySha256: s.sourceIdentitySha256,
      inputSha256: s.inputSha256, frameCount: s.frameCount, modality: s.modality},
    claims: evidence.observations.map((o, i) => ({claimId: `claim-${i + 1}`, observationId: o.observationId,
      modelWeightsSha256: evidence.producer.model.weightsSha256, metric: "label-volume-ml",
      scope: "unknown", valueMl: null, statement: `Измерение для ${o.labelName} не предоставлено.`, anchor: null}))};
}

function sameInput(a: SegmentationEvidence["source"], b: LlmMeasurements["source"]) {
  return a.requestId === b.requestId && a.sourceIdentitySha256 === b.sourceIdentitySha256 &&
    a.inputSha256 === b.inputSha256 && a.frameCount === b.frameCount && a.modality === b.modality;
}

/** Point-only spatial QC, independent of numeric comparability/claimed coverage.
 * The sampler reads the active, already bound mask, never a retained second mask.
 * A label hit does not validate a lesion, anatomy assertion or clinical accuracy. */
export function checkLlmAnchor(specialist: SegmentationEvidence, llm: LlmMeasurements,
  claim: LlmMeasurements["claims"][number], sampleMask?: (point: Point3) => number | null): AnchorCheck | null {
  if (!claim.anchor) return null;
  const o = specialist.observations.find(o => o.observationId === claim.observationId), reasons: string[] = [];
  if (!sameInput(specialist.source, llm.source)) reasons.push(COMPARISON_REASONS.source_binding_mismatch);
  if (claim.modelWeightsSha256 !== specialist.producer.model.weightsSha256) reasons.push(COMPARISON_REASONS.target_mismatch);
  if (claim.anchor.maskSha256 !== specialist.mask.sha256) reasons.push("Точка привязана к другой маске (SHA-256).");
  if (!o) reasons.push(COMPARISON_REASONS.label_unavailable);
  if (o?.review === "rejected") reasons.push(COMPARISON_REASONS.specialist_rejected);
  const base = {pointLpsMm: null, sourceIndex: null, sampledLabelId: null, relation: "not_checked" as const, reasons, review: "needs_review" as const};
  if (reasons.length) return {...base, status: "not_bound"};
  const point = claim.anchor.pointLpsMm;
  const index = transformPoint(invertAffine(specialist.source.geometry.affineLps), point);
  if (!insideImageExtent(index, specialist.source.geometry.dimensions))
    return {...base, status: "outside_volume", reasons: ["Точка находится за пределами загруженного объёма; переход отключён."]};
  let label: number | null = null;
  try { label = sampleMask?.(point) ?? null; } catch { /* A closed runtime is not a background label. */ }
  const checked = typeof label === "number" && Number.isSafeInteger(label) && label >= 0 && label <= 65535;
  return {status: "in_volume", pointLpsMm: [...point], sourceIndex: index, sampledLabelId: checked ? label : null,
    relation: !checked ? "not_checked" : label === 0 ? "background" : label === o!.labelId ? "target_label" : "different_label",
    reasons: checked ? [] : ["Метка в точке не проверена: активная маска недоступна."], review: "needs_review"};
}

/** No image/mask scan or network access. No anatomy-name guessing or voting. */
export function reconcileEvidence(specialist: SegmentationEvidence, llm: LlmMeasurements, sampleMask?: (point: Point3) => number | null) {
  const sameSource = sameInput(specialist.source, llm.source);
  const observations = new Map(specialist.observations.map(o => [o.observationId, o]));
  const comparisons: EvidenceComparison[] = llm.claims.map(c => {
    const o = observations.get(c.observationId), reasons: ComparisonReason[] = [];
    if (!sameSource) reasons.push("source_binding_mismatch");
    if (c.scope !== "loaded-slices") reasons.push("scope_mismatch");
    if (c.metric !== "label-volume-ml") reasons.push("unsupported_metric");
    if (c.modelWeightsSha256 !== specialist.producer.model.weightsSha256) reasons.push("target_mismatch");
    if (!o) reasons.push("label_unavailable");
    if (c.valueMl === null) reasons.push("missing_value");
    if (o?.review === "rejected") reasons.push("specialist_rejected");
    const deltaMl = !reasons.length && o && c.valueMl !== null ? c.valueMl - o.volumeMl : null;
    return {claimId: c.claimId, observationId: c.observationId,
      status: deltaMl === null ? "not_comparable" : deltaMl === 0 ? "numeric_match" : "numeric_difference",
      review: "needs_review", specialistVolumeMl: o?.volumeMl ?? null, llmVolumeMl: c.valueMl, deltaMl, reasons,
      spatial: checkLlmAnchor(specialist, llm, c, sampleMask)};
  });
  return {schema: "opus-evidence-comparison/v1" as const, clinicalStatus: "unverified_research_draft" as const,
    provenance: "imported-unverified" as const, specialist, llm, comparisons};
}
