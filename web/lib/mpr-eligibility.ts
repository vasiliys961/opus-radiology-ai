import type { DicomSeries } from './dicom-series';

/** Conservative local-browser MPR preflight for an 8 GiB Mac. */
export const MAX_MPR_RAW_BYTES = 48 * 1024 * 1024;
export const MAX_MPR_FILES = 200;
export const MAX_MPR_INPUT_BYTES = 256 * 1024 * 1024;

export type MprPreflight = { eligible: boolean; reason: string; estimatedRawMiB: number };

/**
 * This is a resource and metadata check, NOT clinical validation of the volume.
 * Estimated memory can be many times higher after decompression + GPU upload.
 */
export function checkMprEligibility(
  series: Pick<DicomSeries, 'volumeReady' | 'members' | 'warning'> | null,
  fileSizes: readonly number[],
): MprPreflight {
  const result = (eligible: boolean, reason: string, bytes = 0): MprPreflight => ({
    eligible, reason, estimatedRawMiB: Math.round(bytes / 1048576 * 10) / 10,
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
  return result(true, `Предварительно допустимо: ${series.members.length} срезов, ~${(bytes / 1048576).toFixed(1)} МиБ исходных пикселей. В памяти потребуется значительно больше.`, bytes);
}
