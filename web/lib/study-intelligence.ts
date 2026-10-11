import type { DicomSeries } from "./dicom-series";
export type StudyReadiness = {
  modality: "CT" | "MR" | "MIXED" | "UNKNOWN";
  seriesCount: number;
  volumeEligible: number;
  unsafeGeometry: number;
  analysedSlices: number;
  warnings: string[];
  status: "no-study" | "needs-review" | "geometry-ready";
};
/** Pure metadata report: NOT anatomical coverage detection or pathology clearance. */
export function deriveStudyReadiness(series: readonly DicomSeries[]): StudyReadiness {
  const modalities = new Set(series.map(x => x.modality.toUpperCase()).filter(x => x === "CT" || x === "MR"));
  const modality: StudyReadiness["modality"] = modalities.size > 1 ? "MIXED" :
    modalities.has("CT") ? "CT" : modalities.has("MR") ? "MR" : "UNKNOWN";
  const volumeEligible = series.filter(x => x.volumeReady).length;
  const unsafeGeometry = series.filter(x => !x.volumeReady).length;
  const warnings: string[] = [];
  if (!series.length) warnings.push("Сначала загрузите DICOM-исследование.");
  if (modality === "MIXED") warnings.push("Несколько модальностей: нельзя автоматически считать их единым объёмом.");
  if (unsafeGeometry > 0) warnings.push(`Нет подтверждённой геометрии у ${unsafeGeometry} серий; MPR/3D ограничены.`);
  if (series.length > 0) warnings.push("Анатомическая область, последовательность МРТ, фазы КТ и полнота покрытия автоматически ещё не подтверждаются.");
  return {
    modality, seriesCount: series.length, volumeEligible, unsafeGeometry,
    analysedSlices: 0, warnings,
    status: !series.length ? "no-study" : unsafeGeometry || !volumeEligible ? "needs-review" : "geometry-ready",
  };
}
