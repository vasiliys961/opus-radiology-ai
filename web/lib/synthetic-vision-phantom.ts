import { deflateSync } from "node:zlib";
import type { VisionFrame } from "./vision-orchestra";

/**
 * NON-PATIENT mathematical phantoms for exercising real AI provider calls.
 * The images are generated from code; no clinical scan, extracted DICOM pixel,
 * user upload or patient data is ever accepted by the research demo.
 */
export type SyntheticRegion = "head" | "chest" | "abdomen";
export const SYNTHETIC_REGIONS: readonly SyntheticRegion[] = ["head", "chest", "abdomen"];
const WIDTH = 96;
const HEIGHT = 96;
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let j = 0; j < 8; j++)
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, bytes: Buffer): Buffer {
  const tag = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([tag, bytes])));
  return Buffer.concat([length, tag, bytes, checksum]);
}
function ellipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number) {
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
}
/** Shapes are deliberately geometric schematics, never diagnostic likenesses. */
function phantomPng(region: SyntheticRegion, slice: number): string {
  const pixels = Buffer.alloc(HEIGHT * (WIDTH + 1));
  for (let y = 0; y < HEIGHT; y++) {
    const offset = y * (WIDTH + 1);
    pixels[offset] = 0; // PNG filter: None
    for (let x = 0; x < WIDTH; x++) {
      const nx = (x - WIDTH / 2) / (WIDTH / 2);
      const ny = (y - HEIGHT / 2) / (HEIGHT / 2);
      const delta = slice * 0.05;
      let value = 12;
      if (region === "head") {
        const skull = ellipse(nx, ny, 0, 0, 0.84, 0.92);
        const centre = ellipse(nx, ny, 0, 0, 0.69, 0.76);
        value = skull ? (centre ? 111 + Math.round(10 * Math.cos(x / 9) * Math.sin(y / 8)) : 228) : 9;
        if (ellipse(nx, ny, -0.13 + delta, 0.02, 0.14, 0.09) ||
            ellipse(nx, ny, 0.13 + delta, 0.02, 0.14, 0.09)) value = 46;
      } else if (region === "chest") {
        const outer = ellipse(nx, ny, 0, 0.01, 0.92, 0.88);
        const left = ellipse(nx, ny, -0.36, -0.03, 0.28, 0.68);
        const right = ellipse(nx, ny, 0.36, -0.03, 0.28, 0.68);
        const mediastinum = ellipse(nx, ny, delta, 0.07, 0.14, 0.38);
        value = !outer ? 9 : left || right ? 38 : mediastinum ? 189 : 157;
      } else {
        const torso = ellipse(nx, ny, 0, 0.04, 0.96, 0.86);
        const liver = ellipse(nx, ny, -0.32, -0.27, 0.49, 0.23);
        const leftKidney = ellipse(nx, ny, -0.47, 0.25, 0.20, 0.30);
        const rightKidney = ellipse(nx, ny, 0.47, 0.25, 0.20, 0.30);
        const spine = ellipse(nx, ny, delta, 0.20, 0.10, 0.13);
        value = !torso ? 9 : liver ? 174 : spine ? 228 : leftKidney || rightKidney ? 73 : 128;
      }
      pixels[offset + x + 1] = Math.max(0, Math.min(255, value));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0); ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; ihdr[9] = 0; // 8-bit grayscale; one channel.
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
  ]);
  return png.toString("base64");
}
export function syntheticVisionFrames(
  modality: "CT" | "MR", region: SyntheticRegion = modality === "CT" ? "chest" : "head",
): VisionFrame[] {
  if (!SYNTHETIC_REGIONS.includes(region)) throw new Error("Invalid synthetic region");
  const kind = region === "head" ? "brain" : region === "chest" ? "thorax" : "abdomen";
  const sourceRoot = "2.25.20261011001700001";
  return [0, 1].map((index) => ({
    imageId: "synthetic-" + kind + "-" + index,
    mimeType: "image/png" as const,
    base64: phantomPng(region, index),
    seriesUid: sourceRoot,
    sopInstanceUid: "2.25.202610110017000" + (index + 2),
    frameIndex: 0,
    slicePositionMm: index * 3,
    viewLabel: "NON-PATIENT MATHEMATICAL PHANTOM " + region.toUpperCase() +
      " (" + modality + " label) " + (index + 1) + "/2; NOT CLINICAL CT/MRI",
  }));
}
