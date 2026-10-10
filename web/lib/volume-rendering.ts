/** Deterministic, research-only scalar transfer mapping for grayscale volume rendering. */
/** VoxelManager is the authoritative intensity source in Cornerstone3D 4.x.
 * Do not materialize getCompleteScalarDataArray() on an 8 GiB Mac.
 * This accepts a narrow structural interface so it can be tested without WebGL.
 */
export type VolumeIntensitySource = {
  voxelManager?: {
    getRange?: () => readonly number[];
    getMinMax?: () => { min: number | number[]; max: number | number[] };
  } | null;
};

export function getVolumeScalarRange(volume: VolumeIntensitySource): [number, number] {
  const manager = volume.voxelManager;
  if (!manager) throw new Error("DICOM-объём не содержит VoxelManager.");

  const valid = (a: unknown, b: unknown): a is number =>
    typeof a === "number" && typeof b === "number" &&
    Number.isFinite(a) && Number.isFinite(b) && b > a;

  try {
    const range = manager.getRange?.();
    if (range && range.length >= 2 && valid(range[0], range[1])) {
      return [range[0], range[1]];
    }
  } catch { /* try the alternative manager stats API */ }

  try {
    const minMax = manager.getMinMax?.();
    if (minMax && valid(minMax.min, minMax.max)) {
      return [minMax.min as number, minMax.max as number];
    }
  } catch { /* reject below; do not invent intensity values */ }

  throw new Error("Не удалось определить диапазон интенсивностей через VoxelManager.");
}

export type VolumeRenderMode = "composite" | "mip";
export type VolumePalette = "neutral" | "cool";
export type VolumeRenderQuality = "economy" | "balanced" | "fine";
export type OpacityNode = [intensity: number, alpha: number];
export type ColorNode = [intensity: number, red: number, green: number, blue: number];
export type VolumeTransfer = { opacity: OpacityNode[]; color: ColorNode[] };

export function buildVolumeTransfer(range: readonly [number, number], thresholdPercent: number, opacityPercent: number, palette: VolumePalette = "cool"): VolumeTransfer {
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
  const transfer: VolumeTransfer = {
    opacity: [
      [lo, 0], [edge, 0], [x1, a * 0.075], [x2, a * 0.38], [hi, a],
    ],
    color: [
      [lo, 0, 0, 0], [edge, 0.08, 0.13, 0.17],
      [x2, 0.62, 0.70, 0.75], [hi, 1, 1, 1],
    ],
  };
  // At 0% the cutoff and minimum coincide. VTK replaces duplicate nodes;
  // retain a single, deterministic point for each scalar coordinate.
  transfer.opacity = transfer.opacity.filter(([x], i, nodes) => i === 0 || x > nodes[i - 1][0]);
  transfer.color = transfer.color.filter(([x], i, nodes) => i === 0 || x > nodes[i - 1][0]);
  if (palette === "neutral") transfer.color = transfer.color.map(([x, , g]) => [x, g, g, g]);
  return transfer;
}

/** Ray sampling only: does not resample the volume or create anatomical detail. */
export function getVolumeSampling(spacing: readonly number[], dimensions: readonly number[], quality: VolumeRenderQuality) {
  if (spacing.length !== 3 || dimensions.length !== 3 ||
      spacing.some(v => !Number.isFinite(v) || v <= 0) ||
      dimensions.some(v => !Number.isSafeInteger(v) || v < 1)) {
    throw new Error("Неверная геометрия объёма для настройки рендеринга.");
  }
  const multiplier = { economy: 1.5, balanced: 1, fine: 0.5 }[quality];
  const diagonal = Math.hypot(...spacing.map((s, i) => s * (dimensions[i] - 1)));
  // Leave headroom under Cornerstone's 4000-sample ray budget, even in a
  // rotated anisotropic study. Finer samples cannot restore missing slices.
  return {
    sampleDistance: Math.max(Math.min(...spacing) * multiplier, diagonal / 3500),
    imageSampleDistance: quality === "economy" ? 1.5 : 1,
    maximumSamplesPerRay: 4000,
  };
}

/** Narrow VTK adapter, testable without WebGL or a complete scalar array. */
export type VolumeDisplayActor = {
  getMapper(): {
    setBlendMode(mode: number): void;
    setSampleDistance(value: number): unknown;
    setImageSampleDistance(value: number): unknown;
    setMaximumSamplesPerRay(value: number): unknown;
  };
  getProperty(): {
    getScalarOpacity(channel: number): { removeAllPoints(): void; addPoint(x: number, alpha: number): void };
    getRGBTransferFunction(channel: number): { removeAllPoints(): void; addRGBPoint(x: number, r: number, g: number, b: number): void };
    setInterpolationType(mode: number): unknown;
    setScalarOpacityUnitDistance(channel: number, distance: number): unknown;
  };
};

export function applyVolumeDisplay(actor: VolumeDisplayActor, transfer: VolumeTransfer,
  options: ReturnType<typeof getVolumeSampling> & { blendMode: number; interpolationType: number }) {
  const property = actor?.getProperty?.();
  const mapper = actor?.getMapper?.();
  const scalar = property?.getScalarOpacity(0);
  const color = property?.getRGBTransferFunction(0);
  if (!scalar || !color || !mapper?.setBlendMode) {
    throw new Error("Объёмный актор не предоставляет функции отображения.");
  }
  scalar.removeAllPoints();
  for (const [intensity, alpha] of transfer.opacity) scalar.addPoint(intensity, alpha);
  color.removeAllPoints();
  for (const [intensity, r, g, b] of transfer.color) color.addRGBPoint(intensity, r, g, b);
  // VolumeViewport3D.setBlendMode is a no-op in Cornerstone3D 4.18.3.
  // The actor's mapper is the authoritative blend-mode API.
  mapper.setBlendMode(options.blendMode);
  mapper.setSampleDistance(options.sampleDistance);
  mapper.setImageSampleDistance(options.imageSampleDistance);
  mapper.setMaximumSamplesPerRay(options.maximumSamplesPerRay);
  property.setInterpolationType(options.interpolationType);
  // Keep opacity defined per millimetre as the sampling quality changes.
  property.setScalarOpacityUnitDistance(0, 1);
}
