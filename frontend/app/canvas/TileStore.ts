import { Tile } from "./Tile";

export class TileStore {
  private readonly tiles = new Map<string, Tile>();

  private static key(x: number, y: number): string {
    return `${x},${y}`;
  }

  getOrCreate(x: number, y: number): Tile {
    const key = TileStore.key(x, y);
    let tile = this.tiles.get(key);
    if (!tile) {
      tile = new Tile(x, y);
      this.tiles.set(key, tile);
    }
    return tile;
  }

  get(x: number, y: number): Tile | undefined {
    return this.tiles.get(TileStore.key(x, y));
  }

  [Symbol.iterator](): IterableIterator<Tile> {
    return this.tiles.values();
  }
}
