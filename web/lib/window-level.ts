/** Display-only window/level helpers. Never modify source DICOM pixel data. */
export type VoiRange = { lower: number; upper: number };
export type WindowLevel = { width: number; center: number };

export const CT_WINDOW_PRESETS = {
  brain: { label: 'Мозг', width: 80, center: 40 },
  soft: { label: 'Мягкие ткани', width: 400, center: 40 },
  lung: { label: 'Лёгкие', width: 1500, center: -600 },
  bone: { label: 'Кости', width: 2000, center: 300 },
} as const;

/** Use display units (for properly rescaled CT: HU), not raw pixel offsets. */
export function windowLevelToRange(width: number, center: number): VoiRange {
  if (!Number.isFinite(width) || width < 1 || width > 10_000_000 ||
      !Number.isFinite(center) || Math.abs(center) > 1_000_000_000) {
    throw new Error('Неверные значения окна. WW: от 1 до 10 000 000; WC: конечное число.');
  }
  return { lower: center - width / 2, upper: center + width / 2 };
}

export function rangeToWindowLevel(range: VoiRange | null | undefined): WindowLevel | null {
  if (!range || !Number.isFinite(range.lower) || !Number.isFinite(range.upper) ||
      range.upper <= range.lower) return null;
  return { width: range.upper - range.lower, center: (range.upper + range.lower) / 2 };
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.25, Math.min(8, value));
}
