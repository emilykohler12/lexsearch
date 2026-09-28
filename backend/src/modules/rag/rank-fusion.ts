export interface FusedResult<T> {
  item: T;
  score: number;
  /** 1-based position of the item in each list where it appeared. */
  ranks: Partial<Record<string, number>>;
}

/**
 * Reciprocal Rank Fusion: merges ranked lists that use incomparable scores
 * (cosine similarity vs. full-text rank) using only each item's position.
 * Items found by several searches rise to the top.
 */
export function reciprocalRankFusion<T extends { id: string }>(
  lists: Record<string, T[]>,
  k = 60,
): FusedResult<T>[] {
  const fused = new Map<string, FusedResult<T>>();

  for (const [listName, items] of Object.entries(lists)) {
    items.forEach((item, index) => {
      const rank = index + 1;
      const entry = fused.get(item.id) ?? { item, score: 0, ranks: {} };
      entry.score += 1 / (k + rank);
      entry.ranks[listName] = rank;
      fused.set(item.id, entry);
    });
  }

  return [...fused.values()].sort((a, b) => b.score - a.score);
}
