import type { DicomSeries, TechnicalDicomMetadata } from "./dicom-series";

export type StudyIssue = {
  code: "NO_STUDY" | "MULTIPLE_STUDIES" | "UNINDEXED_DICOM" | "MIXED_MODALITY" |
        "MIXED_BODY_REGION" | "UNVERIFIED_REGION" | "GEOMETRY_UNVERIFIED" |
        "LOCALIZER" | "INCONSISTENT_TECHNICAL_PROTOCOL" | "MULTIFRAME" |
        "DUPLICATE_SOP" | "UNKNOWN_COMPLETENESS";
  level: "warning" | "info";
  message: string;
  seriesKey: string | null;
};
export type SeriesIntelligence = {
  key: string;
  label: string;
  modality: string;
  frames: number;
  region: string;
  regionEvidence: "allowlisted-body-part" | "conflicting" | "unknown";
  protocolCandidate: string;
  protocolConfidence: "technical-indication" | "unavailable";
  contrast: "declared" | "unknown";
  imageRole: "LOCALIZER" | "DERIVED" | "PRIMARY" | "UNKNOWN";
  spatialExtentMm: number | null;
  volumeReady: boolean;
  issues: StudyIssue[];
};
export type StudyIntelligenceReport = {
  schema: "opus-study-intelligence/v1";
  indexedSeries: number;
  indexedDicomFiles: number;
  unindexedDicomFiles: number;
  studyCount: number;
  series: SeriesIntelligence[];
  issues: StudyIssue[];
  completeness: "not-verifiable";
  protocolDetection: "technical-metadata-only";
};
const issue = (code: StudyIssue["code"], level: StudyIssue["level"], message: string,
               seriesKey: string | null = null): StudyIssue => ({ code, level, message, seriesKey });
const normalize = (xs: (string | null | undefined)[]) =>
  [...new Set(xs.filter((v): v is string => typeof v === "string" && v.length > 0))];
function sequenceGuess(meta: TechnicalDicomMetadata, modality: string): {
  candidate: string; confidence: SeriesIntelligence["protocolConfidence"]
} {
  if (meta.imageRole === "LOCALIZER") return { candidate: "Локализатор (ImageType)", confidence: "technical-indication" };
  if (modality === "CT") return { candidate: "КТ · параметры фазы не установлены", confidence: "unavailable" };
  if (modality !== "MR") return { candidate: "Протокол не распознан", confidence: "unavailable" };
  const tr = meta.repetitionTimeMs, te = meta.echoTimeMs, ti = meta.inversionTimeMs;
  const codes = meta.mrSequenceCodes ?? [];
  if (codes.includes("IR") && ti !== null && ti !== undefined && ti >= 1000 &&
      tr !== null && tr !== undefined && tr >= 1500)
    return { candidate: "IR / FLAIR-подобный режим (TR/TI; неподтверждено)", confidence: "technical-indication" };
  if (tr !== null && tr !== undefined && te !== null && te !== undefined) {
    if (tr >= 1500 && te >= 70)
      return { candidate: "T2-подобные параметры (TR/TE; неподтверждено)", confidence: "technical-indication" };
    if (tr <= 900 && te <= 40)
      return { candidate: "T1-подобные параметры (TR/TE; неподтверждено)", confidence: "technical-indication" };
  }
  if (codes.length)
    return { candidate: "МР-коды сканирования: " + codes.join(" / "), confidence: "technical-indication" };
  return { candidate: "Последовательность неизвестна", confidence: "unavailable" };
}
function protocolSignature(meta: TechnicalDicomMetadata): string {
  return JSON.stringify({
    role: meta.imageRole ?? "UNKNOWN",
    sequence: [...(meta.mrSequenceCodes ?? [])].sort(),
    tr: meta.repetitionTimeMs ?? null,
    te: meta.echoTimeMs ?? null,
    ti: meta.inversionTimeMs ?? null,
    thick: meta.sliceThicknessMm ?? null,
  });
}
function assessSeries(series: DicomSeries): SeriesIntelligence {
  const metadata = series.members.map(m => m.metadata);
  const first = metadata[0];
  const modality = (series.modality ?? "").toUpperCase();
  const regions = normalize(metadata.map(m => m.bodyRegion));
  const regionEvidence = regions.length === 0 ? "unknown" : regions.length === 1 ?
    "allowlisted-body-part" : "conflicting";
  const candidate = first ? sequenceGuess(first, modality) :
    { candidate: "Нет технических метаданных", confidence: "unavailable" as const };
  const roles = normalize(metadata.map(m => m.imageRole && m.imageRole !== "UNKNOWN" ? m.imageRole : null));
  const imageRole = roles.length === 1 ? roles[0] as SeriesIntelligence["imageRole"] : "UNKNOWN";
  const issues: StudyIssue[] = [];
  if (regionEvidence === "unknown")
    issues.push(issue("UNVERIFIED_REGION", "info", "Область исследования не подтверждена техническим DICOM-кодом.", series.key));
  if (regionEvidence === "conflicting")
    issues.push(issue("MIXED_BODY_REGION", "warning", "Противоречащие коды BodyPartExamined внутри серии.", series.key));
  if (!series.volumeReady)
    issues.push(issue("GEOMETRY_UNVERIFIED", "warning", series.warning ??
      "Для объёмной реконструкции не подтверждена непрерывная однородная геометрия.", series.key));
  if (imageRole === "LOCALIZER")
    issues.push(issue("LOCALIZER", "info", "Обнаружен локализатор; его нельзя считать полноценной диагностической серией.", series.key));
  if (metadata.some(m => (m.numberOfFrames ?? 1) > 1))
    issues.push(issue("MULTIFRAME", "warning", "Мультифреймовая серия требует отдельной проверки декодера.", series.key));
  const signatures = new Set(metadata.map(protocolSignature));
  if (signatures.size > 1)
    issues.push(issue("INCONSISTENT_TECHNICAL_PROTOCOL", "warning",
      "Технические параметры отличаются между кадрами этой серии.", series.key));
  const sopUids = metadata.map(m => m.sopInstanceUid).filter((x): x is string => !!x);
  if (new Set(sopUids).size < sopUids.length)
    issues.push(issue("DUPLICATE_SOP", "warning", "Обнаружены повторные SOPInstanceUID.", series.key));
  return {
    key: series.key, label: series.label, modality, frames: series.members.length,
    region: regionEvidence === "allowlisted-body-part" ? regions[0] : "НЕ ОПРЕДЕЛЕНА",
    regionEvidence, protocolCandidate: candidate.candidate,
    protocolConfidence: candidate.confidence,
    contrast: metadata.some(m => m.contrastAgentDeclared === true) ? "declared" : "unknown",
    imageRole,
    spatialExtentMm: series.volumeReady && series.sliceSpacingMm !== null ?
      Number((series.sliceSpacingMm * (series.members.length - 1)).toFixed(2)) : null,
    volumeReady: series.volumeReady, issues,
  };
}

/**
 * All indexed series, not merely the active series. This examines technical
 * metadata, not pixel contents, pathology, full-organ coverage or privacy.
 */
export function analyzeDicomStudy(
  series: readonly DicomSeries[], unindexedDicomFiles = 0,
): StudyIntelligenceReport {
  if (!Number.isInteger(unindexedDicomFiles) || unindexedDicomFiles < 0) throw new Error("Invalid unindexed count");
  const assessed = series.map(assessSeries);
  const studies = normalize(series.flatMap(s => s.members.map(m => m.metadata.studyUid)));
  const modalities = normalize(series.map(s => s.modality));
  const issues: StudyIssue[] = assessed.flatMap(s => s.issues);
  if (studies.length > 1)
    issues.unshift(issue("MULTIPLE_STUDIES", "warning", "Загружены разные StudyInstanceUID. Нельзя трактовать их как единое исследование."));
  if (modalities.length > 1)
    issues.unshift(issue("MIXED_MODALITY", "warning", "Несколько модальностей: требуется раздельная оценка."));
  if (unindexedDicomFiles > 0)
    issues.unshift(issue("UNINDEXED_DICOM", "warning",
      "Не проиндексировано DICOM-файлов: " + unindexedDicomFiles + ". Состав исследования может быть неполным."));
  if (series.length === 0)
    issues.unshift(issue("NO_STUDY", "info", "Нет проиндексированных DICOM-серий."));
  // Always separate expected study completeness from observed grid regularity:
  // regular input spacing CANNOT prove all sequences or organs were uploaded.
  issues.push(issue("UNKNOWN_COMPLETENESS", "info",
    "Полнота исследования, охват органа, последовательности и фазы не подтверждены без протокола аппарата и контрольной разметки."));
  return {
    schema: "opus-study-intelligence/v1", indexedSeries: assessed.length,
    indexedDicomFiles: series.reduce((n, s) => n + s.members.length, 0),
    unindexedDicomFiles, studyCount: studies.length, series: assessed,
    issues, completeness: "not-verifiable", protocolDetection: "technical-metadata-only",
  };
}
