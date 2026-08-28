import { describe, expect, it } from "vitest";
import {
  chunkViewportKey,
  chunksInViewport,
  containsChunk,
  sameChunkViewport,
} from "~/network/ChunkViewport";

describe("ChunkViewport", () => {
  it("falls back to the bounding box when no precise key set is given", () => {
    const viewport = { minX: 0, minY: 0, maxX: 2, maxY: 1 };
    expect(containsChunk(viewport, 1, 1)).toBe(true);
    expect(containsChunk(viewport, 3, 0)).toBe(false);
    expect(chunksInViewport(viewport)).toHaveLength(6);
  });

  it("restricts membership and iteration to the precise key set", () => {
    const keys = new Set([chunkViewportKey(0, 0), chunkViewportKey(2, 1)]);
    const viewport = { minX: 0, minY: 0, maxX: 2, maxY: 1, keys };

    expect(containsChunk(viewport, 0, 0)).toBe(true);
    expect(containsChunk(viewport, 2, 1)).toBe(true);
    // Inside the bounding box but not actually visible.
    expect(containsChunk(viewport, 1, 0)).toBe(false);

    expect(chunksInViewport(viewport).sort((a, b) => a.x - b.x)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 1 },
    ]);
  });

  it("compares the precise key sets in sameChunkViewport", () => {
    const base = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const a = { ...base, keys: new Set([chunkViewportKey(0, 0)]) };
    const b = { ...base, keys: new Set([chunkViewportKey(0, 0)]) };
    const c = { ...base, keys: new Set([chunkViewportKey(1, 1)]) };

    expect(sameChunkViewport(a, b)).toBe(true);
    expect(sameChunkViewport(a, c)).toBe(false);
    expect(sameChunkViewport(base, a)).toBe(false);
  });
});
