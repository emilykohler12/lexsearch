import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from '../../src/modules/rag/rank-fusion.js';

const items = (...ids: string[]) => ids.map((id) => ({ id }));

describe('reciprocalRankFusion', () => {
  it('ranks items found by both searches above items found by one', () => {
    const fused = reciprocalRankFusion({
      semantic: items('a', 'b', 'c'),
      keyword: items('c', 'd'),
    });
    expect(fused[0]!.item.id).toBe('c');
    expect(fused.map((r) => r.item.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('records the position of each item in every list', () => {
    const fused = reciprocalRankFusion({ semantic: items('a', 'b'), keyword: items('b') });
    const b = fused.find((r) => r.item.id === 'b')!;
    expect(b.ranks).toEqual({ semantic: 2, keyword: 1 });
    expect(b.score).toBeCloseTo(1 / 62 + 1 / 61);
  });

  it('handles empty lists', () => {
    expect(reciprocalRankFusion({ semantic: [], keyword: [] })).toEqual([]);
  });
});
