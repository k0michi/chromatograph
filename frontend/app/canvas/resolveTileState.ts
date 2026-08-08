import type { BlendOperation, TileChunk } from "./Operation";

export interface TileOperationEntry {
  readonly patchHash: string;
  readonly op: BlendOperation;
}

export interface TileRenderState {
  readonly chunk: TileChunk;
  readonly activeBlends: readonly BlendOperation[];
}

export function resolveTileState(chunk: TileChunk, allOpsForTile: readonly TileOperationEntry[]): TileRenderState {
  const sortedBlendOps = [...allOpsForTile].sort((a, b) => a.patchHash.localeCompare(b.patchHash));
  return { chunk, activeBlends: sortedBlendOps.map((entry) => entry.op) };
}
