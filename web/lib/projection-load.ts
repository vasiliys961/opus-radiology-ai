export const MAX_COMPARED_PROJECTIONS = 8;

export function appendProjections<T extends {sopInstanceUid: string | null}>(
  existing: readonly T[],
  incoming: readonly T[],
  limit = MAX_COMPARED_PROJECTIONS,
): {items: T[]; added: number} | {error: string} {
  const known = new Set(existing.map(item => item.sopInstanceUid).filter((uid): uid is string => !!uid));
  const fresh = incoming.filter(item => !item.sopInstanceUid || !known.has(item.sopInstanceUid));
  if (fresh.length === 0) return {error: "Эта проекция уже есть в сравнении."};
  if (existing.length + fresh.length > limit) {
    return {error: `В сравнении помещается ${limit} проекций. Сейчас ${existing.length}. Очистите список, чтобы добавить другие.`};
  }
  return {items: [...existing, ...fresh], added: fresh.length};
}

export function projectionAddedMessage(total: number): string {
  if (total < 2) return "Проекция добавлена. Откройте ещё одну рентгенограмму — она встанет рядом.";
  const word = total % 10 === 1 && total % 100 !== 11 ? "проекция"
    : total % 10 >= 2 && total % 10 <= 4 && (total % 100 < 12 || total % 100 > 14) ? "проекции"
    : "проекций";
  return `В сравнении ${total} ${word}. Следующую можно открыть отдельно.`;
}
