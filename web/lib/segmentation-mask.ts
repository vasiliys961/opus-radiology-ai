/** Bounded NIfTI-1 label-mask import. Affines use row-major 3x4 LPS millimetres. */
export type Point3 = [number, number, number];
export type Affine = [number, number, number, number, number, number, number, number, number, number, number, number];
export type MaskGeometry = { dimensions: Point3; affineLps: Affine };
export type LabelMask = MaskGeometry & {
  data: Uint16Array;
  inverseLps: Affine;
  labels: { id: number; voxels: number; volumeMl: number }[];
  voxelVolumeMm3: number;
};
export const MAX_MASK_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_MASK_VOXELS = 8 * 1024 * 1024;
export const MAX_MASK_LABELS = 256;
const GEOMETRY_TOLERANCE_MM = 0.05;

export function transformPoint(a: readonly number[], p: readonly number[]): Point3 {
  return [a[0]*p[0]+a[1]*p[1]+a[2]*p[2]+a[3],
    a[4]*p[0]+a[5]*p[1]+a[6]*p[2]+a[7],
    a[8]*p[0]+a[9]*p[1]+a[10]*p[2]+a[11]];
}

function determinant(a: Affine) {
  return a[0]*(a[5]*a[10]-a[6]*a[9])-a[1]*(a[4]*a[10]-a[6]*a[8])+a[2]*(a[4]*a[9]-a[5]*a[8]);
}

export function invertAffine(a: Affine): Affine {
  if (a.length !== 12 || a.some(v => !Number.isFinite(v))) throw new Error("Неверная матрица координат маски.");
  const d = determinant(a);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) throw new Error("Вырожденная геометрия маски.");
  const r: Affine = [
    (a[5]*a[10]-a[6]*a[9])/d, (a[2]*a[9]-a[1]*a[10])/d, (a[1]*a[6]-a[2]*a[5])/d, 0,
    (a[6]*a[8]-a[4]*a[10])/d, (a[0]*a[10]-a[2]*a[8])/d, (a[2]*a[4]-a[0]*a[6])/d, 0,
    (a[4]*a[9]-a[5]*a[8])/d, (a[1]*a[8]-a[0]*a[9])/d, (a[0]*a[5]-a[1]*a[4])/d, 0,
  ];
  const shift = transformPoint(r, [a[3], a[7], a[11]]);
  r[3] = -shift[0]; r[7] = -shift[1]; r[11] = -shift[2];
  return r;
}

function corners(dim: Point3): Point3[] {
  return Array.from({length: 8}, (_, i) => [i&1 ? dim[0]-1 : 0, i&2 ? dim[1]-1 : 0, i&4 ? dim[2]-1 : 0]);
}

function compatibleAffines(a: Affine, b: Affine, dimensions: Point3) {
  return corners(dimensions).every(p => {
    const aw = transformPoint(a, p), bw = transformPoint(b, p);
    return Math.hypot(...aw.map((v, i) => v-bw[i])) <= GEOMETRY_TOLERANCE_MM;
  });
}

function qform(view: DataView, little: boolean): Affine {
  let b = view.getFloat32(256, little), c = view.getFloat32(260, little), d = view.getFloat32(264, little);
  const squared = b*b+c*c+d*d;
  if (![b,c,d].every(Number.isFinite) || squared > 1.0001) throw new Error("Неверный quaternion NIfTI.");
  let a = Math.sqrt(Math.max(0, 1-squared));
  if (a < 1e-7) { const length = Math.sqrt(squared); b/=length; c/=length; d/=length; a=0; }
  const dx = view.getFloat32(80,little), dy = view.getFloat32(84,little), dz = view.getFloat32(88,little);
  const qfac = view.getFloat32(76,little);
  if (![dx,dy,dz].every(v=>Number.isFinite(v)&&v>0) || !Number.isFinite(qfac) || ![0,1,-1].includes(qfac)) throw new Error("Неверный шаг qform NIfTI.");
  const z = dz * (qfac < 0 ? -1 : 1);
  return [(a*a+b*b-c*c-d*d)*dx, 2*(b*c-a*d)*dy, 2*(b*d+a*c)*z, view.getFloat32(268,little),
    2*(b*c+a*d)*dx, (a*a+c*c-b*b-d*d)*dy, 2*(c*d-a*b)*z, view.getFloat32(272,little),
    2*(b*d-a*c)*dx, 2*(c*d+a*b)*dy, (a*a+d*d-c*c-b*b)*z, view.getFloat32(276,little)];
}

export function parseNiftiMask(buffer: ArrayBuffer): LabelMask {
  if (buffer.byteLength < 352 || buffer.byteLength > MAX_MASK_FILE_BYTES) throw new Error("Размер NIfTI-маски недопустим (лимит 32 МиБ).");
  const view = new DataView(buffer);
  const little = view.getInt32(0,true) === 348;
  if (!little && view.getInt32(0,false) !== 348) throw new Error("Поддерживается только NIfTI-1, не NIfTI-2/Analyze.");
  if ([110,43,49,0].some((v,i)=>view.getUint8(344+i)!==v)) throw new Error("Нужен единый файл NIfTI-1 .nii, не пара .hdr/.img.");
  const n = view.getInt16(40,little);
  if (n < 3 || n > 7) throw new Error("Нужна трёхмерная скалярная маска.");
  const dimensions: Point3 = [view.getInt16(42,little),view.getInt16(44,little),view.getInt16(46,little)];
  if (dimensions.some(v=>v<1) || Array.from({length:n-3},(_,i)=>view.getInt16(48+i*2,little)).some(v=>v!==1)) throw new Error("Маски с временными кадрами или несколькими каналами не поддерживаются.");
  const count = dimensions.reduce((a,b)=>a*b,1);
  if (!Number.isSafeInteger(count) || count > MAX_MASK_VOXELS) throw new Error("Маска превышает лимит 8 миллионов вокселей для M1.");
  const datatype = view.getInt16(70,little), bitpix = view.getInt16(72,little);
  const sizes: Record<number,number> = {2:1,4:2,8:4,16:4,256:1,512:2,768:4};
  const bytes = sizes[datatype];
  if (!bytes || bitpix !== bytes*8) throw new Error("Неподдерживаемый или противоречивый тип данных маски.");
  const offset = view.getFloat32(108,little);
  if (!Number.isSafeInteger(offset) || offset < 352 || offset+count*bytes > buffer.byteLength) throw new Error("Маска содержит неверный offset или неполные пиксельные данные.");
  const slope = view.getFloat32(112,little), intercept = view.getFloat32(116,little);
  if (!Number.isFinite(slope) || (slope !== 0 && (!Number.isFinite(intercept) || slope !== 1 || intercept !== 0))) throw new Error("Маска с масштабированием интенсивности не поддерживается: нужны целочисленные метки.");
  const unit = view.getUint8(123)&7;
  const unitScale = ({1:1000,2:1,3:0.001} as Record<number,number>)[unit];
  if (!unitScale) throw new Error("Пространственные единицы NIfTI неизвестны.");
  const qc = view.getInt16(252,little), sc = view.getInt16(254,little);
  if ([qc,sc].some(code=>code<0 || code>2)) throw new Error("Маска в шаблонных координатах не накладывается на исходную DICOM-серию.");
  let s: Affine | null = sc ? Array.from({length:12},(_,i)=>view.getFloat32(280+i*4,little)) as Affine : null;
  let q: Affine | null = qc ? qform(view,little) : null;
  // NIfTI uses RAS. DICOM patient space uses LPS; convert translations too.
  const toLps = (a: Affine) => a.map((v,i)=>v*unitScale*(i<8 ? -1 : 1)) as Affine;
  s = s ? toLps(s) : null; q = q ? toLps(q) : null;
  if (!s && !q) throw new Error("У маски нет подтверждённой sform/qform геометрии.");
  if (s) invertAffine(s);
  if (q) invertAffine(q);
  if (s && q && !compatibleAffines(s,q,dimensions)) throw new Error("sform и qform маски противоречат друг другу.");
  const affineLps = (s ?? q)!;
  const inverseLps = invertAffine(affineLps);
  const voxelVolumeMm3 = Math.abs(determinant(affineLps));
  const data = new Uint16Array(count);
  const counts = new Map<number,number>();
  const read = (at: number) => {
    switch(datatype) {
      case 2: return view.getUint8(at); case 256: return view.getInt8(at);
      case 4: return view.getInt16(at,little); case 512: return view.getUint16(at,little);
      case 8: return view.getInt32(at,little); case 768: return view.getUint32(at,little);
      default: return view.getFloat32(at,little);
    }
  };
  for (let i=0; i<count; i++) {
    const label = read(offset+i*bytes);
    if (!Number.isInteger(label) || label<0 || label>65535) throw new Error("Нужна маска меток 0…65535; вероятности и отрицательные значения не поддерживаются.");
    data[i] = label;
    if (label) counts.set(label,(counts.get(label)??0)+1);
    if (counts.size>MAX_MASK_LABELS) throw new Error("В маске больше 256 меток.");
  }
  const labels = [...counts.entries()].sort(([a],[b])=>a-b).map(([id,voxels])=>({id,voxels,volumeMl:voxels*voxelVolumeMm3/1000}));
  return { dimensions, affineLps, inverseLps, data, labels, voxelVolumeMm3 };
}

/** Stream gzip expansion with a hard cap; never decompress an unbounded gzip first. */
export async function readNiftiMaskFile(file: Blob): Promise<LabelMask> {
  if (!file.size || file.size>MAX_MASK_FILE_BYTES) throw new Error("Файл маски должен быть не больше 32 МиБ.");
  const magic = new Uint8Array(await file.slice(0,2).arrayBuffer());
  if (magic[0]!==31 || magic[1]!==139) return parseNiftiMask(await file.arrayBuffer());
  if (typeof DecompressionStream === "undefined") throw new Error("Этот браузер не распаковывает gzip. Выберите распакованный .nii.");
  const reader = file.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = []; let total=0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      total+=value.byteLength;
      if (total>MAX_MASK_FILE_BYTES) throw new Error("Распакованная маска превышает лимит 32 МиБ.");
      chunks.push(value);
    }
  } catch(cause) { await reader.cancel().catch(()=>{}); throw cause; }
  finally { reader.releaseLock(); }
  const result = new Uint8Array(total); let cursor=0;
  for (const chunk of chunks) { result.set(chunk,cursor); cursor+=chunk.byteLength; }
  return parseNiftiMask(result.buffer);
}

export function sourceGeometry(dimensions: readonly number[], indexToWorld: (p: Point3)=>readonly number[]): MaskGeometry {
  if (dimensions.length!==3 || dimensions.some(v=>!Number.isSafeInteger(v)||v<1)) throw new Error("Исходная сетка неизвестна.");
  const origin = indexToWorld([0,0,0]);
  const axes = ([ [1,0,0],[0,1,0],[0,0,1] ] as Point3[]).map(p=>indexToWorld(p).map((v,i)=>v-origin[i]));
  const affineLps = [axes[0][0],axes[1][0],axes[2][0],origin[0],axes[0][1],axes[1][1],axes[2][1],origin[1],axes[0][2],axes[1][2],axes[2][2],origin[2]] as Affine;
  invertAffine(affineLps);
  return {dimensions:[...dimensions] as Point3,affineLps};
}

/** Permit only the same physical grid, including axis permutation or reversal. No implicit resampling. */
export function assertMaskMatchesSource(mask: MaskGeometry, source: MaskGeometry): void {
  const inv = invertAffine(mask.affineLps);
  const origin = transformPoint(inv,transformPoint(source.affineLps,[0,0,0]));
  const columns = ([ [1,0,0],[0,1,0],[0,0,1] ] as Point3[]).map(p=>transformPoint(inv,transformPoint(source.affineLps,p)).map((v,i)=>v-origin[i]));
  const used = new Set<number>();
  const mapping = [0,1,2].map(row=>{
    const axis = columns.findIndex(c=>Math.abs(Math.abs(c[row])-1)<0.001);
    if (axis<0 || used.has(axis) || columns.some((c,i)=>i!==axis&&Math.abs(c[row])>0.001) || mask.dimensions[row]!==source.dimensions[axis]) throw new Error("Сетка маски отличается от DICOM. Автоматическое пересэмплирование отключено.");
    used.add(axis); return {axis,sign:columns[axis][row]>0 ? 1 : -1};
  });
  for (const p of corners(source.dimensions)) {
    const expected = mapping.map(({axis,sign},row)=>sign>0 ? p[axis] : mask.dimensions[row]-1-p[axis]);
    const mw = transformPoint(mask.affineLps,expected), sw = transformPoint(source.affineLps,p);
    if (Math.hypot(...mw.map((v,i)=>v-sw[i]))>GEOMETRY_TOLERANCE_MM) throw new Error("Положение или ориентация маски не совпадает с DICOM (допуск 0,05 мм).");
  }
}

const COLORS: readonly Point3[] = [[52,211,153],[251,146,60],[96,165,250],[232,121,249],[250,204,21],[45,212,191],[251,113,133],[167,139,250]];
export function maskColor(label: number): Point3 { return COLORS[(label-1)%COLORS.length] ?? COLORS[0]; }

/** Orthographic display raster. Sample discrete labels by nearest neighbour, never interpolate IDs. */
export function renderMaskPlane(mask: LabelMask, origin: Point3, dx: Point3, dy: Point3,
  width: number, height: number, opacity: number, selected: number | null): Uint8ClampedArray {
  if (![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=384) || !Number.isFinite(opacity)||opacity<0||opacity>1 || [...origin,...dx,...dy].some(v=>!Number.isFinite(v))) throw new Error("Неверные параметры наложения маски.");
  const start = transformPoint(mask.inverseLps,origin);
  const nextX = transformPoint(mask.inverseLps,origin.map((v,i)=>v+dx[i]));
  const nextY = transformPoint(mask.inverseLps,origin.map((v,i)=>v+dy[i]));
  const sx = nextX.map((v,i)=>v-start[i]), sy = nextY.map((v,i)=>v-start[i]);
  const data = new Uint8ClampedArray(width*height*4), [nx,ny,nz] = mask.dimensions;
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const i = Math.round(start[0]+x*sx[0]+y*sy[0]), j = Math.round(start[1]+x*sx[1]+y*sy[1]), k = Math.round(start[2]+x*sx[2]+y*sy[2]);
    if (i<0||j<0||k<0||i>=nx||j>=ny||k>=nz) continue;
    const label = mask.data[i+nx*(j+ny*k)];
    if (!label || (selected!==null && label!==selected)) continue;
    const at = (x+width*y)*4, color=maskColor(label);
    data[at]=color[0];data[at+1]=color[1];data[at+2]=color[2];data[at+3]=Math.round(opacity*255);
  }
  return data;
}
