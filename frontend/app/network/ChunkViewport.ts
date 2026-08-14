export interface ChunkViewport {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface ChunkCoordinate {
  readonly x: number;
  readonly y: number;
}

export function chunksInViewport(viewport: ChunkViewport): ChunkCoordinate[] {
  const chunks: ChunkCoordinate[] = [];
  for (let y = viewport.minY; y <= viewport.maxY; y++) {
    for (let x = viewport.minX; x <= viewport.maxX; x++) chunks.push({ x, y });
  }
  return chunks;
}

export function containsChunk(viewport: ChunkViewport, x: number, y: number): boolean {
  return x >= viewport.minX && x <= viewport.maxX && y >= viewport.minY && y <= viewport.maxY;
}

export function sameChunkViewport(a: ChunkViewport | null, b: ChunkViewport): boolean {
  return a?.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
}
