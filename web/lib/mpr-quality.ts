import type { DicomSeries } from "./dicom-series";

export type MprPlane = "axial" | "coronal" | "sagittal";
export type MprQuality = {
  nativePlane: MprPlane | null;
  interpolationRisk: "unknown" | "low" | "high";
  pixelSpacingMm: [number, number] | null;
  sliceSpacingMm: number | null;
  anisotropy: number | null;
  message: string;
};

/**
 * Describes *sampling geometry*, never clinical fidelity or accuracy.
 * Three orthogonal reconstructions cannot create spatial information between
 * thick/widely spaced acquired slices. For oblique series, nativePlane=null.
 */
export function assessMprQuality(series: Pick<DicomSeries, "members" | "sliceSpacingMm"> | null): MprQuality {
  const unknown: MprQuality = {
    nativePlane: null, interpolationRisk: "unknown", pixelSpacingMm: null,
    sliceSpacingMm: null, anisotropy: null,
    message: "Размер вокселя не подтверждён: качество реконструкций оценить нельзя.",
  };
  if (!series?.members.length) return unknown;
  const first = series.members[0].metadata;
  const spacing = first.pixelSpacing;
  const through = series.sliceSpacingMm;
  const valid = (n: number | null | undefined): n is number => n !== null && n !== undefined && Number.isFinite(n) && n > 0;
  if (!spacing || spacing.length !== 2 || !spacing.every(valid) || !valid(through)) return unknown;
  const steps = [spacing[0], spacing[1], through];
  const ratio = Math.max(...steps) / Math.min(...steps);
  const orient = first.imageOrientationPatient;
  let nativePlane: MprPlane | null = null;
  if (orient?.length === 6 && orient.every(Number.isFinite)) {
    const [rx, ry, rz, cx, cy, cz] = orient;
    const cross = [ry*cz-rz*cy, rz*cx-rx*cz, rx*cy-ry*cx];
    const length = Math.hypot(...cross);
    if (Math.abs(length - 1) < 0.03) {
      const normal = cross.map(v => Math.abs(v/length));
      const strongest = Math.max(...normal);
      if (strongest > 0.9) nativePlane = (["sagittal", "coronal", "axial"] as MprPlane[])[normal.indexOf(strongest)];
    }
  }
  return {
    nativePlane,
    interpolationRisk: ratio > 2 ? "high" : "low",
    pixelSpacingMm: [spacing[0], spacing[1]], sliceSpacingMm: through,
    anisotropy: Math.round(ratio * 10) / 10,
    message: ratio > 2
      ? `Анизотропные воксели (отношение шагов ${ratio.toFixed(1)}:1). Реконструкции поперёк исходных срезов могут быть размытыми или ступенчатыми; утраченные детали не восстановить.`
      : `Шаг вокселей относительно равномерный (${ratio.toFixed(1)}:1). Интерполяция всё равно не добавляет исходной информации.`,
  };
}
