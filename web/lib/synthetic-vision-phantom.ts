import { deflateSync } from "node:zlib";
import type { VisionFrame } from "./vision-orchestra";

/**
 * Genuine valid PNG images generated from mathematical phantoms.
 * The route accepts NO caller-supplied pixels or medical records.
 * These fixtures contain no patient data and no simulated clinical finding.
 */
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
function phantomPng(kind: "thorax" | "brain"): string {
  const pixels = Buffer.alloc(HEIGHT * (WIDTH + 1));
  for (let y = 0; y < HEIGHT; y++) {
    const offset = y * (WIDTH + 1);
    pixels[offset] = 0; // PNG filter: None
    for (let x = 0; x < WIDTH; x++) {
      const nx = (x - WIDTH / 2) / (WIDTH / 2);
      const ny = (y - HEIGHT / 2) / (HEIGHT / 2);
      const body = nx * nx / .76 + ny * ny / .9 < 1;
      const left = (nx + .31) ** 2 / .11 + ny ** 2 / .42 < 1;
      const right = (nx - .31) ** 2 / .11 + ny ** 2 / .42 < 1;
      const brain = nx * nx / .55 + ny * ny / .6 < 1;
      const ring = nx * nx / .7 + ny * ny / .75 < 1 && !brain;
      const value = kind === "thorax" ?
        (!body ? 9 : left || right ? 36 : 162) :
        (ring ? 226 : brain ? 128 + Math.round(8 * Math.cos(x / 9) * Math.sin(y / 7)) : 12);
      pixels[offset + x + 1] = Math.max(0, Math.min(255, value));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0); ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; ihdr[9] = 0; // 8-bit grayscale, no alpha
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
  ]);
  return png.toString("base64");
}
export function syntheticVisionFrames(modality: "CT" | "MR"): VisionFrame[] {
  const kind = modality === "CT" ? "thorax" : "brain";
  return [0, 1].map((index) => ({
    imageId: "synthetic-" + kind + "-" + index,
    mimeType: "image/png" as const,
    base64: phantomPng(kind),
    seriesUid: "2.25.20261011001700001",
    sopInstanceUid: "2.25.202610110017000" + (index + 2),
    frameIndex: 0, // one frame per synthetic SOP Instance; index is not a DICOM frame number
    slicePositionMm: index * 3,
    viewLabel: "MATHEMATICAL PHANTOM " + (index + 1) + "/2 - not a clinical CT/MRI scan",
  }));
}
