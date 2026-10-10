/** Deterministic, research-only scalar transfer mapping for grayscale volume rendering. */
export type VolumeRenderMode = "composite" | "mip";
export type OpacityNode = [intensity: number, alpha: number];
export type ColorNode = [intensity: number, red: number, green: number, blue: number];
export type VolumeTransfer = { opacity: OpacityNode[]; color: ColorNode[] };

export function buildVolumeTransfer(range: readonly [number, number], thresholdPercent: number, opacityPercent: number): VolumeTransfer {
  const [lo, hi] = range;
  if (![lo, hi, thresholdPercent, opacityPercent].every(Number.isFinite) || hi <= lo) {
    throw new Error("Invalid scalar range or display settings");
  }
  const p = Math.min(0.85, Math.max(0, thresholdPercent / 100));
  const a = Math.min(1, Math.max(0.05, opacityPercent / 100));
  const span = hi - lo;
  // Strictly increasing nodes, even when threshold is 0%. MIP uses a
  // full-range mapping (0% cutoff and 100% alpha), not a previous VR curve.
  const edge = lo + span * p;
  const x1 = lo + span * Math.min(0.999, p + 0.001);
  const x2 = lo + span * (p + (1 - p) * 0.45);
  return {
    opacity: [
      [lo, 0], [edge, 0], [x1, a * 0.075], [x2, a * 0.38], [hi, a],
    ],
    color: [
      [lo, 0, 0, 0], [edge, 0.08, 0.13, 0.17],
      [x2, 0.62, 0.70, 0.75], [hi, 1, 1, 1],
    ],
  };
}
