import { mat3 } from "gl-matrix";
import { TILE_SIZE } from "./Tile";

export const CHUNK_VIEW_PROJECTION = mat3.fromValues(2 / TILE_SIZE, 0, 0, 0, 2 / TILE_SIZE, 0, -1, -1, 1);

export interface ChunkPosition {
  readonly chunkX: number;
  readonly chunkY: number;
  readonly subchunkX: number;
  readonly subchunkY: number;
}

export function worldToChunkPosition(worldX: number, worldY: number): ChunkPosition {
  const chunkX = Math.floor(worldX / TILE_SIZE);
  const chunkY = Math.floor(worldY / TILE_SIZE);
  return {
    chunkX,
    chunkY,
    subchunkX: Math.min(TILE_SIZE - 1, Math.max(0, Math.floor(worldX - chunkX * TILE_SIZE))),
    subchunkY: Math.min(TILE_SIZE - 1, Math.max(0, Math.floor(worldY - chunkY * TILE_SIZE))),
  };
}
