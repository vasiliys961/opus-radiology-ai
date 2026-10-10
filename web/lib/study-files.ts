/** Prevent re-importing unchanged browser files when the same folder is selected again.
 * Does not hash file contents or infer clinical identity.
 */
export type LocalFileRef = {
  name: string;
  size: number;
  lastModified: number;
  webkitRelativePath?: string;
};

const fingerprint = (file: LocalFileRef): string =>
  JSON.stringify([file.webkitRelativePath || file.name, file.size, file.lastModified]);

export function uniqueNewFiles<T extends LocalFileRef>(
  existing: readonly LocalFileRef[], incoming: readonly T[],
): { newFiles: T[]; duplicates: number } {
  const seen = new Set(existing.map(fingerprint));
  const newFiles: T[] = [];
  let duplicates = 0;
  for (const file of incoming) {
    const key = fingerprint(file);
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    newFiles.push(file);
  }
  return {newFiles, duplicates};
}
