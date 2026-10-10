/** Geometry helpers for interactive MPR. Operate only on physical patient-space
 * coordinates (millimetres); never assume axial/coronal/sagittal align with I/J/K.
 */
export type Vec3 = [number, number, number];

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function alignCameraWithPoint(
  focalPoint: Vec3, position: Vec3, viewPlaneNormal: Vec3, point: Vec3,
): { focalPoint: Vec3; position: Vec3 } {
  const displacement = dot(point.map((x, i) => x - focalPoint[i]), viewPlaneNormal);
  const shift = viewPlaneNormal.map((v) => v * displacement);
  return {
    focalPoint: focalPoint.map((v, i) => v + shift[i]) as Vec3,
    position: position.map((v, i) => v + shift[i]) as Vec3,
  };
}

/** When scrolling one plane, keep crosshair's in-plane position unchanged. */
export function crosshairAfterScroll(
  point: Vec3, before: Vec3, after: Vec3, viewPlaneNormal: Vec3,
): Vec3 {
  const displacement = dot(after.map((x, i) => x - before[i]), viewPlaneNormal);
  return point.map((v, i) => v + displacement * viewPlaneNormal[i]) as Vec3;
}

export function safeSliceIndex(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(total) || total < 1) return 0;
  return Math.min(total - 1, Math.max(0, Math.round(value)));
}

export function insideImageExtent(index: readonly number[], dimensions: readonly number[]): boolean {
  return index.length === 3 && dimensions.length === 3 &&
    index.every((v, i) => Number.isFinite(v) && v >= -0.5 && v <= dimensions[i] - 0.5);
}
