/** In-browser experimental viewer guardrails for 8 GB Apple Silicon machines. */
export const MAX_DICOM_FILES = 300;
export const MAX_DICOM_BYTES = 1_000_000_000;
export const MAX_SINGLE_DICOM_BYTES = 128 * 1024 * 1024;

/** Validate before making any file-reading or decoder allocations. */
export function validateViewerFileSelection(files: readonly { size: number }[]): string | null {
  if (!files.length) return 'Не выбраны файлы.';
  if (files.length > MAX_DICOM_FILES) return `Слишком много файлов: ${files.length}. Для M1 пока допустимо не более ${MAX_DICOM_FILES}.`;
  let total = 0;
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0) return 'Некорректный размер файла.';
    if (file.size > MAX_SINGLE_DICOM_BYTES) return 'Найден файл больше 128 МБ: он пока не поддерживается в лабораторном режиме.';
    total += file.size;
    if (total > MAX_DICOM_BYTES) return 'Серия превышает ограничение 1 ГБ для Mac с 8 ГБ RAM.';
  }
  return null;
}
