import type { DicomSeries } from './dicom-series';

/** Conservative local-browser MPR preflight for an 8 GiB Mac. */
export const MAX_MPR_RAW_BYTES = 48 * 1024 * 1024;
export const MAX_MPR_FILES = 200;
export const MAX_MPR_INPUT_BYTES = 256 * 1024 * 1024;
/** Provisional, conservative M1 budget for CPU decode/cache + volume + GPU copy.
 * Not an actual measurement of Safari/OS RAM, and not a guarantee of no swap.
 */
export const MPR_DECODED_VOXEL_BYTES_ESTIMATE = 4;
export const MPR_ACTIVE_BUFFER_MULTIPLIER = 3;
export const MPR_FIXED_RENDER_RESERVE_BYTES = 64 * 1024 * 1024;
export const MAX_MPR_ESTIMATED_WORKING_BYTES = 256 * 1024 * 1024;

export type MprPreflight = {
  eligible: boolean;
  reason: string;
  estimatedRawMiB: number;
  estimatedDecodedMiB?: number;
  estimatedWorkingMiB?: number;
};
const asMiB=(bytes:number)=>Math.round(bytes / 1048576 * 10) / 10;

/** A best-effort estimate; actual memory use is still platform-dependent. */
export function assessMprDecodedMemory(decodedBytes:number,totalVoxels:number): {
  eligible:boolean; reason:string; estimatedWorkingMiB:number;
} {
  if(!Number.isSafeInteger(totalVoxels)||totalVoxels<1||
      !Number.isSafeInteger(decodedBytes)||decodedBytes<0)
    return {eligible:false,reason:"Размер декодированного объёма неизвестен — MPR остановлен.",estimatedWorkingMiB:0};
  const conservative=Math.max(decodedBytes,totalVoxels*MPR_DECODED_VOXEL_BYTES_ESTIMATE);
  const working=conservative*MPR_ACTIVE_BUFFER_MULTIPLIER+MPR_FIXED_RENDER_RESERVE_BYTES;
  if(!Number.isSafeInteger(working)||working>MAX_MPR_ESTIMATED_WORKING_BYTES)
    return {eligible:false,reason:`Оценка буферов MPR ${Math.ceil(working/1048576)} МиБ превышает бюджет ${MAX_MPR_ESTIMATED_WORKING_BYTES/1048576} МиБ для M1; загрузите меньший исходный фрагмент.`,estimatedWorkingMiB:asMiB(working)};
  return {eligible:true,reason:"Размер декодированных данных укладывается в предварительную оценку памяти.",estimatedWorkingMiB:asMiB(working)};
}

/**
 * This is a resource and metadata check, NOT clinical validation of the volume.
 * Estimated memory can be many times higher after decompression + GPU upload.
 */
export function checkMprEligibility(
  series: Pick<DicomSeries, 'volumeReady' | 'members' | 'warning'> | null,
  fileSizes: readonly number[],
): MprPreflight {
  const result = (eligible: boolean, reason: string, bytes = 0, working?:number): MprPreflight => ({
    eligible, reason, estimatedRawMiB: asMiB(bytes),
    ...(working===undefined?{}:{
      estimatedDecodedMiB:asMiB(bytes/2*MPR_DECODED_VOXEL_BYTES_ESTIMATE),
      estimatedWorkingMiB:asMiB(working),
    }),
  });
  if (!series) return result(false, 'Сначала выберите DICOM-серию.');
  if (!series.volumeReady) return result(false, series.warning ?? 'Геометрия серии не подтверждена для MPR.');
  if (series.members.length < 3) return result(false, 'Недостаточно срезов для MPR.');
  if (series.members.length > MAX_MPR_FILES) return result(false, `Для M1 в режиме MPR допускается не более ${MAX_MPR_FILES} файлов.`);
  if (fileSizes.length !== series.members.length || fileSizes.some(size => !Number.isSafeInteger(size) || size <= 0)) {
    return result(false, 'Неверные размеры или неполный набор файлов серии.');
  }
  const first = series.members[0].metadata;
  const rows = first.rows;
  const cols = first.columns;
  if (!rows || !cols || rows > 2048 || cols > 2048 || !Number.isSafeInteger(rows * cols)) {
    return result(false, 'Недопустимые размеры среза для локального MPR.');
  }
  if (series.members.some(({metadata:m}) => m.rows !== rows || m.columns !== cols || (m.numberOfFrames ?? 1) !== 1)) {
    return result(false, 'Серия содержит несовместимые размеры или мультифреймовые объекты.');
  }
  const bytes = rows * cols * series.members.length * 2;
  if (!Number.isSafeInteger(bytes) || bytes > MAX_MPR_RAW_BYTES) {
    return result(false, `Расчётный объём данных ${Math.ceil(bytes / 1048576)} МиБ выше лимита 48 МиБ для M1.`, bytes);
  }
  const total = fileSizes.reduce((sum, n) => sum + n, 0);
  if (total > MAX_MPR_INPUT_BYTES) return result(false, 'Размер файлов серии превышает лимит 256 МиБ для MPR.', bytes);
  const decoded=assessMprDecodedMemory(0,rows*cols*series.members.length);
  if (!decoded.eligible) return result(false,decoded.reason,bytes,decoded.estimatedWorkingMiB*1048576);
  return result(true, `Предварительно допустимо: ${series.members.length} срезов, ~${(bytes / 1048576).toFixed(1)} МиБ исходных 16-битных пикселей; оценка рабочих буферов ~${decoded.estimatedWorkingMiB.toFixed(1)} МиБ. Это не фактическая RAM/GPU и не гарантия отсутствия swap.`,
    bytes,decoded.estimatedWorkingMiB*1048576);
}
