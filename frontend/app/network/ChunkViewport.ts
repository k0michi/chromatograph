export interface ChunkViewport {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /**
   * Precise set of visible chunk keys ("x,y"). When present it overrides the
   * bounding box, so a rotated viewport only queries the tiles it actually
   * covers instead of the whole enclosing rectangle.
   */
  readonly keys?: ReadonlySet<string>;
}

export interface ChunkCoordinate {
  readonly x: number;
  readonly y: number;
}

export function chunkViewportKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function chunksInViewport(viewport: ChunkViewport): ChunkCoordinate[] {
  if (viewport.keys) {
    return [...viewport.keys].map((key) => {
      const comma = key.indexOf(",");
      return { x: Number(key.slice(0, comma)), y: Number(key.slice(comma + 1)) };
    });
  }
  const chunks: ChunkCoordinate[] = [];
  for (let y = viewport.minY; y <= viewport.maxY; y++) {
    for (let x = viewport.minX; x <= viewport.maxX; x++) chunks.push({ x, y });
  }
  return chunks;
}

export function containsChunk(viewport: ChunkViewport, x: number, y: number): boolean {
  if (viewport.keys) return viewport.keys.has(chunkViewportKey(x, y));
  return x >= viewport.minX && x <= viewport.maxX && y >= viewport.minY && y <= viewport.maxY;
}

export function sameChunkViewport(a: ChunkViewport | null, b: ChunkViewport): boolean {
  if (!a) return false;
  if (a.minX !== b.minX || a.minY !== b.minY || a.maxX !== b.maxX || a.maxY !== b.maxY) return false;
  if (!a.keys && !b.keys) return true;
  if (!a.keys || !b.keys || a.keys.size !== b.keys.size) return false;
  for (const key of a.keys) {
    if (!b.keys.has(key)) return false;
  }
  return true;
}
