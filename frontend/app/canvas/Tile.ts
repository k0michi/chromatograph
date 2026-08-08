import type { BindGroup } from "~/webgl/BindGroup";
import type { Framebuffer } from "~/webgl/Framebuffer";
import type { Texture } from "~/webgl/Texture";
import type { BlendOperation } from "./Operation";
import type { TileOperationEntry } from "./resolveTileState";

export const TILE_SIZE = 256;

export interface TileSnapshot {
  texture: Texture;
  bindGroup: BindGroup;
  framebuffer: Framebuffer;
}

export class Tile {
  readonly operationEntries: TileOperationEntry[] = [];
  snapshot: TileSnapshot | null = null;

  constructor(
    readonly x: number,
    readonly y: number,
  ) { }

  addOperation(patchHash: string, op: BlendOperation): void {
    this.operationEntries.push({ patchHash, op });
  }
}
