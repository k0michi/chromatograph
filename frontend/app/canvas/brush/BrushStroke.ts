import { mat3 } from "gl-matrix";
import type { CanvasRenderer } from "../CanvasRenderer";
import { CHUNK_VIEW_PROJECTION } from "../chunkSpace";
import { BlendMode, CompositeOp, type BlendOperation } from "../Operation";
import { TILE_SIZE, type TileSnapshot } from "../Tile";
import { encodePngInWorker } from "../PngEncoderWorker";
import type { Brush } from "./Brush";

interface ChunkAccumulation {
  chunkX: number;
  chunkY: number;
  snapshot: TileSnapshot;
  spareSnapshot: TileSnapshot;
}

function chunkKey(chunkX: number, chunkY: number): string {
  return `${chunkX},${chunkY}`;
}

export class BrushStroke {
  private lastStampPoint: { x: number; y: number } | null = null;
  private readonly touchedChunks = new Map<string, ChunkAccumulation>();

  constructor(
    private readonly renderer: CanvasRenderer,
    private readonly brush: Brush,
  ) { }

  begin(worldX: number, worldY: number): void {
    this.lastStampPoint = { x: worldX, y: worldY };
    this.stampAt(worldX, worldY);
  }

  moveTo(worldX: number, worldY: number): void {
    if (!this.lastStampPoint) {
      this.begin(worldX, worldY);
      return;
    }

    const spacing = Math.max(1, this.brush.settings.size * this.brush.settings.spacing);
    let lastX = this.lastStampPoint.x;
    let lastY = this.lastStampPoint.y;
    let distance = Math.hypot(worldX - lastX, worldY - lastY);

    while (distance >= spacing) {
      const t = spacing / distance;
      const stampX = lastX + (worldX - lastX) * t;
      const stampY = lastY + (worldY - lastY) * t;
      this.stampAt(stampX, stampY);
      lastX = stampX;
      lastY = stampY;
      distance = Math.hypot(worldX - lastX, worldY - lastY);
    }

    this.lastStampPoint = { x: lastX, y: lastY };
  }

  async end(): Promise<void> {
    this.lastStampPoint = null;
    if (this.touchedChunks.size === 0) {
      return;
    }

    const touched = Array.from(this.touchedChunks.values());
    try {
      const operations: BlendOperation[] = await Promise.all(touched.map(async (accumulation) => {
        const rgba = accumulation.snapshot.framebuffer.readRgba8(TILE_SIZE, TILE_SIZE);
        return {
          type: "blend",
          chunk: { x: accumulation.chunkX, y: accumulation.chunkY },
          parents: this.renderer.getChunkParents(accumulation.chunkX, accumulation.chunkY),
          compositeOp: CompositeOp.SourceOver,
          blendMode: BlendMode.Normal,
          opacity: 1,
          imageBytes: await encodePngInWorker(rgba, TILE_SIZE, TILE_SIZE),
        };
      }));
      await this.renderer.commitPatch(operations);
    } finally {
      this.disposeAccumulations(touched);
    }
  }

  cancel(): void {
    this.lastStampPoint = null;
    this.disposeAccumulations(Array.from(this.touchedChunks.values()));
  }

  private disposeAccumulations(accumulations: readonly ChunkAccumulation[]): void {
    for (const accumulation of accumulations) {
      const key = chunkKey(accumulation.chunkX, accumulation.chunkY);
      if (this.renderer.uncommittedOverlays.get(key)?.bindGroup === accumulation.snapshot.bindGroup) {
        this.renderer.uncommittedOverlays.delete(key);
      }
      this.renderer.disposeSnapshot(accumulation.snapshot);
      this.renderer.disposeSnapshot(accumulation.spareSnapshot);
    }
    this.touchedChunks.clear();
  }

  private stampAt(worldX: number, worldY: number): void {
    const { texture: stampTexture } = this.brush.getStamp(this.renderer);
    const { size, opacity } = this.brush.settings;

    const minChunkX = Math.floor((worldX - size / 2) / TILE_SIZE);
    const maxChunkX = Math.floor((worldX + size / 2) / TILE_SIZE);
    const minChunkY = Math.floor((worldY - size / 2) / TILE_SIZE);
    const maxChunkY = Math.floor((worldY + size / 2) / TILE_SIZE);

    for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY++) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
        const accumulation = this.getOrCreateAccumulation(chunkX, chunkY);
        const localX = worldX - chunkX * TILE_SIZE - size / 2;
        const localY = worldY - chunkY * TILE_SIZE - size / 2;
        const model = mat3.fromValues(size, 0, 0, 0, size, 0, localX, localY, 1);
        const mvp = mat3.multiply(mat3.create(), CHUNK_VIEW_PROJECTION, model);

        const previous = accumulation.snapshot;
        this.renderer.compositeOntoSnapshot(
          previous,
          accumulation.spareSnapshot,
          stampTexture,
          mvp,
          opacity,
        );
        accumulation.snapshot = accumulation.spareSnapshot;
        accumulation.spareSnapshot = previous;
        this.renderer.uncommittedOverlays.set(chunkKey(chunkX, chunkY), {
          chunkX,
          chunkY,
          bindGroup: accumulation.snapshot.bindGroup,
        });
      }
    }
  }

  private getOrCreateAccumulation(chunkX: number, chunkY: number): ChunkAccumulation {
    const key = chunkKey(chunkX, chunkY);
    const existing = this.touchedChunks.get(key);
    if (existing) {
      return existing;
    }

    const snapshot = this.renderer.createEmptySnapshot();
    const accumulation: ChunkAccumulation = {
      chunkX,
      chunkY,
      snapshot,
      spareSnapshot: this.renderer.createEmptySnapshot(),
    };
    this.touchedChunks.set(key, accumulation);
    this.renderer.uncommittedOverlays.set(key, { chunkX, chunkY, bindGroup: snapshot.bindGroup });
    return accumulation;
  }
}
