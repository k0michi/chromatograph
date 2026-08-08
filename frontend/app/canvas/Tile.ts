import type { BindGroup } from "~/webgl/BindGroup";
import type { Framebuffer } from "~/webgl/Framebuffer";
import type { Texture } from "~/webgl/Texture";
import type { BlendOperation } from "./Operation";

export const TILE_SIZE = 256;

export interface TileSnapshot {
  texture: Texture;
  bindGroup: BindGroup;
  framebuffer: Framebuffer;
}

export interface TileOperationEntry {
  readonly patchHash: string;
  readonly op: BlendOperation;
  active: boolean;
}

export class Tile {
  readonly operationEntries: TileOperationEntry[] = [];
  snapshot: TileSnapshot | null = null;

  constructor(
    readonly x: number,
    readonly y: number,
  ) { }

  addOperation(patchHash: string, op: BlendOperation): TileOperationEntry {
    const entry: TileOperationEntry = { patchHash, op, active: true };
    this.operationEntries.push(entry);
    return entry;
  }
}
