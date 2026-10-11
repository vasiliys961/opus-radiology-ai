/**
 * v1.7 evidence contract: visible source references are mandatory for asserted
 * findings. Evidence must not imply unseen anatomy was inspected.
 */
export type FindingStatus = "candidate" | "verified_by_human" | "rejected" | "requires_recheck";
export type CoverageStatus = "assessed" | "partially_assessed" | "not_assessed";
export type AnatomicalFinding = {
  findingId: string;
  sign: string;
  anatomy: string;
  status: FindingStatus;
  source: {
    seriesUid: string;
    sopInstanceUid: string | null;
    frameIndex: number | null;
    slicePositionMm: number | null;
  };
  measurements: { diameterMm: number | null; volumeMl: number | null };
  model: { id: string; provider: "openrouter" | "polza" | "local" | "research"; version: string | null };
  limitations: string[];
};
export type EvidenceJson = {
  schema: "opus-evidence/v1";
  modality: "CT" | "MR";
  coverage: CoverageStatus;
  seriesReviewed: string[];
  findings: AnatomicalFinding[];
  warnings: string[];
};
const safeText = (value: unknown, max = 500): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const optionalNumber = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
export function validateEvidenceJson(value: unknown): value is EvidenceJson {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.schema !== "opus-evidence/v1" || !["CT", "MR"].includes(String(v.modality)) ||
      !["assessed", "partially_assessed", "not_assessed"].includes(String(v.coverage))) return false;
  if (!Array.isArray(v.seriesReviewed) || v.seriesReviewed.length > 256 ||
      !v.seriesReviewed.every((s: unknown) => safeText(s, 180))) return false;
  if (!Array.isArray(v.warnings) || v.warnings.length > 100 ||
      !v.warnings.every((s: unknown) => typeof s === "string" && s.length <= 500)) return false;
  if (!Array.isArray(v.findings) || v.findings.length > 500) return false;
  if (v.coverage === "not_assessed" && v.findings.length !== 0) return false;
  const seen = new Set<string>();
  for (const item of v.findings) {
    if (!item || typeof item !== "object") return false;
    const f = item as Record<string, unknown>;
    if (!safeText(f.findingId, 128) || seen.has(f.findingId)) return false;
    seen.add(f.findingId);
    if (!safeText(f.sign) || !safeText(f.anatomy) ||
        !["candidate", "verified_by_human", "rejected", "requires_recheck"].includes(String(f.status))) return false;
    const source = f.source as Record<string, unknown> | null;
    if (!source || !safeText(source.seriesUid, 180) ||
        !v.seriesReviewed.includes(source.seriesUid) ||
        !(source.sopInstanceUid === null || safeText(source.sopInstanceUid, 180)) ||
        !(source.frameIndex === null || (Number.isInteger(source.frameIndex) && Number(source.frameIndex) >= 0)) ||
        !(source.slicePositionMm === null || (typeof source.slicePositionMm === "number" && Number.isFinite(source.slicePositionMm)))) return false;
    const m = f.measurements as Record<string, unknown> | null;
    if (!m || !optionalNumber(m.diameterMm) || !optionalNumber(m.volumeMl)) return false;
    const model = f.model as Record<string, unknown> | null;
    if (!model || !safeText(model.id, 180) ||
        !["openrouter", "polza", "local", "research"].includes(String(model.provider)) ||
        !(model.version === null || safeText(model.version, 180))) return false;
    if (!Array.isArray(f.limitations) || f.limitations.length > 20 ||
        !f.limitations.every((x: unknown) => typeof x === "string" && x.length <= 500)) return false;
  }
  return true;
}
