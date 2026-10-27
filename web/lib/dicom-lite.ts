/**
 * Deliberately limited DICOM Part 10 parser for research preview ONLY.
 * Supports single-frame, uncompressed monochrome Little Endian DICOM.
 * Unsupported transfer syntaxes, RGB, encapsulated pixel data and enhanced multi-frame
 * MUST fail closed. No patient-identifying metadata is extracted or displayed.
 * No files are sent to any server.
 */
export type DicomPreviewMetadata = {
  width: number;
  height: number;
  bitsAllocated: 8 | 16;
  transferSyntax: string;
  modality: string;
  instanceNumber: number | null;
  windowCenter: number | null;
  windowWidth: number | null;
};

export type DicomFrame = {
  metadata: DicomPreviewMetadata;
  pixelOffset: number;
  pixelLength: number;
  signed: boolean;
  bitsStored: number;
  highBit: number;
  slope: number;
  intercept: number;
  inverse: boolean;
  bytes: ArrayBuffer;
};

const LONG_VR = new Set(["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "UC", "UR", "UT", "UN"]);
const EXPLICIT_LE = "1.2.840.10008.1.2.1";
const IMPLICIT_LE = "1.2.840.10008.1.2";
const MAX_PIXELS = 4096 * 4096;
const MAX_PREVIEW_FILE_BYTES = 64 * 1024 * 1024; // Guard 8 GB Macs from huge / unsupported multi-frame objects

export class DicomPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DicomPreviewError";
  }
}

const trimText = (value: string) => value.replace(/\0/g, "").trim();

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.byteLength) throw new DicomPreviewError("Некорректная длина элемента DICOM.");
  let result = "";
  for (let i = offset; i < offset + length; i++) result += String.fromCharCode(bytes[i]);
  return trimText(result);
}

/** Parses metadata without exposing patient name, ID, dates or textual descriptions. */
export function parseDicomFrame(buffer: ArrayBuffer): DicomFrame {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 160 || ascii(bytes, 128, 4) !== "DICM") {
    throw new DicomPreviewError("Поддерживаются только DICOM Part 10 с сигнатурой DICM.");
  }
  let offset = 132;
  let explicit = true;
  let metaPhase = true;
  let syntax = "";
  let width = 0;
  let height = 0;
  let bitsAllocated = 0;
  let bitsStored = 0;
  let highBit: number | null = null;
  let photometric = "";
  let signed = false;
  let samples = 1;
  let frames = 1;
  let slope = 1;
  let intercept = 0;
  let inverse = false;
  let modality = "";
  let instanceNumber: number | null = null;
  let windowCenter: number | null = null;
  let windowWidth: number | null = null;
  let pixelOffset = -1;
  let pixelLength = 0;

  while (offset + 8 <= bytes.byteLength) {
    const group = view.getUint16(offset, true);
    const element = view.getUint16(offset + 2, true);
    if (metaPhase && group !== 0x0002) {
      metaPhase = false;
      if (syntax !== EXPLICIT_LE && syntax !== IMPLICIT_LE) {
        throw new DicomPreviewError("Сжатый или неподдерживаемый Transfer Syntax. Для таких файлов подключим Cornerstone3D.");
      }
      explicit = syntax === EXPLICIT_LE;
    }
    let length: number;
    let valueOffset: number;
    if (explicit) {
      const vr = ascii(bytes, offset + 4, 2);
      if (LONG_VR.has(vr)) {
        if (offset + 12 > bytes.byteLength) throw new DicomPreviewError("Повреждённый заголовок DICOM.");
        length = view.getUint32(offset + 8, true);
        valueOffset = offset + 12;
      } else {
        length = view.getUint16(offset + 6, true);
        valueOffset = offset + 8;
      }
    } else {
      length = view.getUint32(offset + 4, true);
      valueOffset = offset + 8;
    }
    if (length === 0xffffffff) throw new DicomPreviewError("Последовательности неопределённой длины пока не поддерживаются.");
    if (valueOffset + length > bytes.byteLength) throw new DicomPreviewError("Файл DICOM повреждён или обрезан.");
    const tag = group * 65536 + element;
    // Read ONLY technical tags, never DICOM patient identifiers.
    switch (tag) {
      case 0x00020010: syntax = ascii(bytes, valueOffset, length); break;
      case 0x00080060: modality = ascii(bytes, valueOffset, length); break;
      case 0x00200013: {
        const n = Number.parseInt(ascii(bytes, valueOffset, length), 10);
        instanceNumber = Number.isFinite(n) ? n : null;
        break;
      }
      case 0x00280002: if (length >= 2) samples = view.getUint16(valueOffset, true); break;
      case 0x00280004: {
        photometric = ascii(bytes, valueOffset, length);
        inverse = photometric === "MONOCHROME1";
        break;
      }
      case 0x00280008: frames = Number.parseInt(ascii(bytes, valueOffset, length), 10); break;
      case 0x00280010: if (length >= 2) height = view.getUint16(valueOffset, true); break;
      case 0x00280011: if (length >= 2) width = view.getUint16(valueOffset, true); break;
      case 0x00280100: if (length >= 2) bitsAllocated = view.getUint16(valueOffset, true); break;
      case 0x00280101: if (length >= 2) bitsStored = view.getUint16(valueOffset, true); break;
      case 0x00280102: if (length >= 2) highBit = view.getUint16(valueOffset, true); break;
      case 0x00280103: if (length >= 2) signed = view.getUint16(valueOffset, true) === 1; break;
      case 0x00281050: {
        const v = Number.parseFloat(ascii(bytes, valueOffset, length).split("\\")[0]);
        windowCenter = Number.isFinite(v) ? v : null;
        break;
      }
      case 0x00281051: {
        const v = Number.parseFloat(ascii(bytes, valueOffset, length).split("\\")[0]);
        windowWidth = Number.isFinite(v) ? v : null;
        break;
      }
      case 0x00281052: {
        const v = Number.parseFloat(ascii(bytes, valueOffset, length));
        if (Number.isFinite(v)) intercept = v;
        break;
      }
      case 0x00281053: {
        const v = Number.parseFloat(ascii(bytes, valueOffset, length));
        if (Number.isFinite(v)) slope = v;
        break;
      }
      case 0x7fe00010: pixelOffset = valueOffset; pixelLength = length; break;
    }
    if (pixelOffset >= 0) break;
    offset = valueOffset + length;
  }
  if (pixelOffset < 0) throw new DicomPreviewError("Pixel Data не найдены.");
  if (samples !== 1 || frames !== 1 || !["MONOCHROME1", "MONOCHROME2"].includes(photometric)) {
    throw new DicomPreviewError("Поддерживаются только одиночные MONOCHROME1/2 кадры. Цветные, палитровые и мультифреймовые изображения требуют полноценного декодера.");
  }
  if (!width || !height || width * height > MAX_PIXELS) throw new DicomPreviewError("Неподдерживаемый размер изображения.");
  if (bitsAllocated !== 8 && bitsAllocated !== 16) throw new DicomPreviewError("Поддерживаются только пиксели 8/16 bit.");
  if (!bitsStored) bitsStored = bitsAllocated;
  if (bitsStored < 1 || bitsStored > bitsAllocated) throw new DicomPreviewError("Некорректное значение Bits Stored.");
  highBit ??= bitsStored - 1;
  if (highBit >= bitsAllocated || highBit + 1 < bitsStored) {
    throw new DicomPreviewError("Некорректное положение значащих бит (High Bit).");
  }
  if (pixelLength < width * height * (bitsAllocated / 8)) throw new DicomPreviewError("Недостаточный объём пиксельных данных.");
  return {
    metadata: { width, height, bitsAllocated: bitsAllocated as 8 | 16, transferSyntax: syntax, modality, instanceNumber, windowCenter, windowWidth },
    bytes: buffer, pixelOffset, pixelLength, signed, bitsStored, highBit, slope, intercept, inverse,
  };
}

/** Direct clinical-useful quantitative tool: actual ORIGINAL DICOM CT pixel
 * values inside physician-selected circular ROI, not a simulated detector.
 * Rescale slope/intercept are verified against independent header metadata.
 * Never implies osteoporosis, fibrosis, steatosis or malignant lesions.
 */
import type {TechnicalDicomMetadata} from "./dicom-series.ts";
export type CtRoiMeasurement={
  center:{x:number;y:number};radiusPixels:number;pixelCount:number;
  spacingMm:[number,number];areaMm2:number;
  rescaleType:"HU";
  meanHu:number;medianHu:number;stdDevHu:number;p10Hu:number;p90Hu:number;
  minHu:number;maxHu:number;
  histogram:{lowHu:number;highHu:number;count:number}[];
};
export function measureCtDicomCircularRoi(
 frame:DicomFrame, header:TechnicalDicomMetadata,
 x:number,y:number,radius:number,
):CtRoiMeasurement {
 const m=frame.metadata;
 const spacing=header.pixelSpacing;
 if (m.modality!=="CT"||header.modality!=="CT"||
     header.rescaleUnit!=="HU"||
     typeof header.rescaleSlope!=="number"||!Number.isFinite(header.rescaleSlope)||
     header.rescaleSlope<=0||
     typeof header.rescaleIntercept!=="number"||!Number.isFinite(header.rescaleIntercept)||
     !spacing||spacing.length!==2||
     !spacing.every(v=>Number.isFinite(v)&&v>=.1&&v<=5)||
     header.rows!==m.height||header.columns!==m.width||
     Math.abs(frame.slope-header.rescaleSlope)>1e-7||
     Math.abs(frame.intercept-header.rescaleIntercept)>1e-5) {
   throw new DicomPreviewError("Для измерения HU нужна исходная КТ с подтверждёнными Rescale Slope/Intercept, Rescale Type=HU и PixelSpacing.");
 }
 if(![x,y,radius].every(Number.isFinite)||radius<2||radius>64||
    x-radius<0||y-radius<0||x+radius>=m.width||y+radius>=m.height)
   throw new DicomPreviewError("Круг ROI должен целиком находиться внутри исходного КТ-среза.");
 const values:number[]=[];
 const data=new DataView(frame.bytes);
 const modulus=2**frame.bitsStored,signBit=modulus/2;
 const byteSize=m.bitsAllocated/8, divisor=2**(frame.highBit+1-frame.bitsStored);
 const ymin=Math.ceil(y-radius),ymax=Math.floor(y+radius);
 const xmin=Math.ceil(x-radius),xmax=Math.floor(x+radius);
 for(let row=ymin;row<=ymax;row++)for(let col=xmin;col<=xmax;col++){
   if((row-y)**2+(col-x)**2>radius**2)continue;
   const offset=frame.pixelOffset+(row*m.width+col)*byteSize;
   let raw=m.bitsAllocated===8?data.getUint8(offset):data.getUint16(offset,true);
   raw=Math.floor(raw/divisor)%modulus;
   if(frame.signed&&raw>=signBit)raw-=modulus;
   const hu=raw*frame.slope+frame.intercept;
   if(!Number.isFinite(hu)||hu< -2048||hu>10000)
     throw new DicomPreviewError("Некорректные или неподдерживаемые значения плотности исходной КТ.");
   values.push(hu);
 }
 if(values.length<12)throw new DicomPreviewError("ROI слишком мал для измерения.");
 values.sort((a,b)=>a-b);
 const n=values.length,sum=values.reduce((a,b)=>a+b,0),mean=sum/n;
 const percentile=(fraction:number)=>{
   const index=(n-1)*fraction,k=Math.floor(index),remainder=index-k;
   return values[k]*(1-remainder)+values[Math.min(n-1,k+1)]*remainder;
 };
 const variance=values.reduce((a,v)=>a+(v-mean)**2,0)/n;
 const min=values[0],max=values[n-1];
 const bins=16;
 const counts=Array.from({length:bins},()=>0);
 for(const value of values)counts[Math.min(bins-1,Math.floor((value-min)/(max-min||1)*bins))]++;
 const round=(v:number)=>Math.round(v*100)/100;
 return {
   center:{x:round(x),y:round(y)},radiusPixels:radius,pixelCount:n,
   spacingMm:[spacing[0],spacing[1]],
   areaMm2:round(n*spacing[0]*spacing[1]),rescaleType:"HU",
   meanHu:round(mean),medianHu:round(percentile(.5)),stdDevHu:round(Math.sqrt(variance)),
   p10Hu:round(percentile(.1)),p90Hu:round(percentile(.9)),
   minHu:round(min),maxHu:round(max),
   histogram:counts.map((count,i)=>({
     lowHu:round(min+(max-min)*i/bins),highHu:round(min+(max-min)*(i+1)/bins),count,
   })),
 };
}

/** Renders a single image, preserving the original pixels in memory (no cropping). */
export function renderDicomPixels(frame: DicomFrame): Uint8ClampedArray {
  const { width, height, bitsAllocated, windowCenter, windowWidth } = frame.metadata;
  const view = new DataView(frame.bytes);
  const size = width * height;
  const intensities = new Float32Array(size);
  let min = Infinity;
  let max = -Infinity;
  const modulus = 2 ** frame.bitsStored;
  const signBit = modulus / 2;
  for (let i = 0; i < size; i++) {
    const at = frame.pixelOffset + i * (bitsAllocated / 8);
    let value = bitsAllocated === 8 ? view.getUint8(at) : view.getUint16(at, true);
    // DICOM High Bit may describe left-justified samples; do not discard their high bits.
    value = Math.floor(value / (2 ** (frame.highBit + 1 - frame.bitsStored))) % modulus;
    if (frame.signed && value >= signBit) value -= modulus;
    const result = value * frame.slope + frame.intercept;
    intensities[i] = result;
    if (result < min) min = result;
    if (result > max) max = result;
  }
  let low = min;
  let high = max;
  if (windowCenter !== null && windowWidth !== null && windowWidth >= 1) {
    // DICOM PS3.3 LINEAR VOI LUT, applied to modality-scaled values.
    low = windowCenter - 0.5 - (windowWidth - 1) / 2;
    high = windowCenter - 0.5 + (windowWidth - 1) / 2;
  }
  const output = new Uint8ClampedArray(size * 4);
  for (let i = 0; i < size; i++) {
    // DICOM LINEAR VOI WC/WW=1 is a threshold, not an all-black image.
    const v = high <= low
      ? (windowCenter !== null && intensities[i] > windowCenter - 0.5 ? 255 : 0)
      : Math.round(Math.max(0, Math.min(255, ((intensities[i] - low) / (high - low)) * 255)));
    const grey = frame.inverse ? 255 - v : v;
    const j = i * 4;
    output[j] = grey; output[j + 1] = grey; output[j + 2] = grey; output[j + 3] = 255;
  }
  return output;
}

export async function decodeDicomPreview(file: File,options:{maxPixels?:number}={}): Promise<{url: string; metadata: DicomPreviewMetadata}> {
  if (file.size > MAX_PREVIEW_FILE_BYTES) {
    throw new DicomPreviewError("Файл больше 64 МБ. Не загружаем его целиком в память; нужен потоковый DICOM-декодер.");
  }
  const frame = parseDicomFrame(await file.arrayBuffer());
  if(options.maxPixels!==undefined&&(!Number.isSafeInteger(options.maxPixels)||options.maxPixels<1||frame.metadata.width*frame.metadata.height>options.maxPixels))
    throw new DicomPreviewError("Кадр превышает лимит локальной копии. Откройте исходный срез в Cornerstone.");
  const pixels = renderDicomPixels(frame);
  const canvas = document.createElement("canvas");
  canvas.width = frame.metadata.width;
  canvas.height = frame.metadata.height;
  const context = canvas.getContext("2d");
  if (!context) throw new DicomPreviewError("Не удалось создать графический контекст.");
  const data = context.createImageData(canvas.width, canvas.height);
  data.data.set(pixels);
  context.putImageData(data, 0, 0);
  return { url: canvas.toDataURL("image/png"), metadata: frame.metadata };
}
