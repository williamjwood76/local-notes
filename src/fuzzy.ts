export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.trim().toLowerCase();
  const hay = text.toLowerCase();
  if (!needle) return 1;
  let at = 0;
  let score = 0;
  let streak = 0;
  for (let index = 0; index < hay.length && at < needle.length; index++) {
    if (hay[index] === needle[at]) {
      streak += 1;
      score += streak * 3;
      if (index === 0 || /[\s/_.-]/.test(hay[index - 1])) score += 4;
      at += 1;
    } else {
      streak = 0;
    }
  }
  if (at < needle.length) return null;
  return score - hay.length * 0.01;
}

export function fuzzyRank<T>(query: string, items: T[], text: (item: T) => string): T[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((entry): entry is { item: T; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}
