import { mat3 } from "gl-matrix";
import type { Texture } from "~/webgl/Texture";
import type { CanvasRenderer } from "../CanvasRenderer";
import { CHUNK_VIEW_PROJECTION } from "../chunkSpace";
import { BlendMode, CompositeOp, type BlendOperation } from "../Operation";
import { TILE_SIZE, type TileSnapshot } from "../Tile";
import { encodePngInWorker } from "../PngEncoderWorker";
import type { Brush } from "./Brush";

interface ChunkAccumulation {
  chunkX: number;
  chunkY: number;
  source: SnapshotAccumulator;
  previewSnapshot: TileSnapshot;
}

class SnapshotAccumulator {
  private current: TileSnapshot;
  private spare: TileSnapshot;

  constructor(private readonly renderer: CanvasRenderer) {
    this.current = renderer.createEmptySnapshot();
    this.spare = renderer.createEmptySnapshot();
  }

  get snapshot(): TileSnapshot {
    return this.current;
  }

  composite(texture: Texture, mvp: mat3, opacity: number): void {
    this.renderer.compositeOntoSnapshot(this.current, this.spare, texture, mvp, opacity);
    [this.current, this.spare] = [this.spare, this.current];
  }

  dispose(): void {
    this.renderer.disposeSnapshot(this.current);
    this.renderer.disposeSnapshot(this.spare);
  }
}

function chunkKey(chunkX: number, chunkY: number): string {
  return `${chunkX},${chunkY}`;
}

export class BrushStroke {
  private lastStampPoint: { x: number; y: number } | null = null;
  private readonly touchedChunks = new Map<string, ChunkAccumulation>();
  private readonly compositeOp: CompositeOp;

  constructor(
    private readonly renderer: CanvasRenderer,
    private readonly brush: Brush,
  ) {
    this.compositeOp = brush.settings.compositeOp;
  }

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
        const rgba = await accumulation.source.snapshot.framebuffer.readRgba8Async(TILE_SIZE, TILE_SIZE);
        return {
          type: "blend",
          chunk: { x: accumulation.chunkX, y: accumulation.chunkY },
          parents: this.renderer.getChunkParents(accumulation.chunkX, accumulation.chunkY),
          compositeOp: this.compositeOp,
          blendMode: BlendMode.Normal,
          opacity: 1,
          imageBytes: await encodePngInWorker(rgba, TILE_SIZE, TILE_SIZE),
        };
      }));
      await this.renderer.commitPatch(operations);
    } finally {
      for (const accumulation of touched) {
        const key = chunkKey(accumulation.chunkX, accumulation.chunkY);
        const overlay = this.renderer.uncommittedOverlays.get(key);
        if (overlay?.bindGroup === accumulation.previewSnapshot.bindGroup) {
          this.renderer.uncommittedOverlays.delete(key);
        }
        accumulation.source.dispose();
        this.renderer.disposeSnapshot(accumulation.previewSnapshot);
      }
      this.touchedChunks.clear();
      this.renderer.invalidate();
    }
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

        accumulation.source.composite(stampTexture, mvp, opacity);
        this.updatePreview(accumulation);
      }
    }
  }

  private getOrCreateAccumulation(chunkX: number, chunkY: number): ChunkAccumulation {
    const key = chunkKey(chunkX, chunkY);
    const existing = this.touchedChunks.get(key);
    if (existing) {
      return existing;
    }

    this.renderer.activateChunk(chunkX, chunkY);

    const accumulation: ChunkAccumulation = {
      chunkX,
      chunkY,
      source: new SnapshotAccumulator(this.renderer),
      previewSnapshot: this.renderer.createEmptySnapshot(),
    };
    this.touchedChunks.set(key, accumulation);
    this.updatePreview(accumulation);
    return accumulation;
  }

  private updatePreview(accumulation: ChunkAccumulation): void {
    const key = chunkKey(accumulation.chunkX, accumulation.chunkY);
    const destination = this.renderer.tiles.get(accumulation.chunkX, accumulation.chunkY)?.snapshot
      ?? this.renderer.transparentSnapshot;
    const model = mat3.fromValues(TILE_SIZE, 0, 0, 0, TILE_SIZE, 0, 0, 0, 1);
    const mvp = mat3.multiply(mat3.create(), CHUNK_VIEW_PROJECTION, model);
    this.renderer.compositeOntoSnapshot(
      destination,
      accumulation.previewSnapshot,
      accumulation.source.snapshot.texture,
      mvp,
      1,
      true,
      this.compositeOp,
    );
    this.renderer.uncommittedOverlays.set(key, {
      chunkX: accumulation.chunkX,
      chunkY: accumulation.chunkY,
      bindGroup: accumulation.previewSnapshot.bindGroup,
    });
    this.renderer.invalidate();
  }
}
