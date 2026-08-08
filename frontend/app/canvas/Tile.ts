import type { Patch } from "./Patch";

export const TILE_SIZE = 256;

export class Tile {
  readonly patches: Patch[] = [];

  constructor(
    readonly x: number,
    readonly y: number,
  ) { }

  addPatch(patch: Patch): void {
    this.patches.push(patch);
  }
}
