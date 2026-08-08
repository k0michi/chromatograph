import { mat3 } from "gl-matrix";
import type { BindGroup } from "~/webgl/BindGroup";
import type { Framebuffer } from "~/webgl/Framebuffer";
import type { Texture } from "~/webgl/Texture";
import type { CanvasRenderer } from "../CanvasRenderer";
import { CHUNK_VIEW_PROJECTION } from "../chunkSpace";
import { BlendMode, CompositeOp, type BlendOperation } from "../Operation";
import { TILE_SIZE } from "../Tile";
import type { Brush } from "./Brush";

interface ChunkAccumulation {
  chunkX: number;
  chunkY: number;
  texture: Texture;
  framebuffer: Framebuffer;
  bindGroup: BindGroup;
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
    const operations: BlendOperation[] = touched.map((accumulation) => ({
      type: "blend",
      chunk: { x: accumulation.chunkX, y: accumulation.chunkY },
      parents: [],
      compositeOp: CompositeOp.SourceOver,
      blendMode: BlendMode.Normal,
      opacity: 1,
      imageBytes: accumulation.framebuffer.readRgba8(TILE_SIZE, TILE_SIZE),
      texture: accumulation.texture,
      bindGroup: accumulation.bindGroup,
    }));

    try {
      await this.renderer.commitPatch(operations);
    } finally {
      for (const accumulation of touched) {
        const key = chunkKey(accumulation.chunkX, accumulation.chunkY);
        if (this.renderer.uncommittedOverlays.get(key)?.bindGroup === accumulation.bindGroup) {
          this.renderer.uncommittedOverlays.delete(key);
        }
        accumulation.framebuffer.dispose();
      }
      this.touchedChunks.clear();
    }
  }

  private stampAt(worldX: number, worldY: number): void {
    const { bindGroup: stampBindGroup } = this.brush.getStamp(this.renderer);
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

        const pass = this.renderer.beginPass({
          framebuffer: accumulation.framebuffer,
          width: TILE_SIZE,
          height: TILE_SIZE,
        });
        this.renderer.drawQuad(pass, mvp, stampBindGroup, opacity);
        pass.end();
      }
    }
  }

  private getOrCreateAccumulation(chunkX: number, chunkY: number): ChunkAccumulation {
    const key = chunkKey(chunkX, chunkY);
    const existing = this.touchedChunks.get(key);
    if (existing) {
      return existing;
    }

    const texture = this.renderer.device.createTexture({
      source: { width: TILE_SIZE, height: TILE_SIZE, data: null },
    });
    const framebuffer = this.renderer.device.createFramebuffer({ colorAttachment: texture });
    const bindGroup = this.renderer.createPatchBindGroup(texture);

    this.renderer.beginPass({ framebuffer, width: TILE_SIZE, height: TILE_SIZE }, [0, 0, 0, 0]).end();

    const accumulation: ChunkAccumulation = { chunkX, chunkY, texture, framebuffer, bindGroup };
    this.touchedChunks.set(key, accumulation);
    this.renderer.uncommittedOverlays.set(key, { chunkX, chunkY, bindGroup });
    return accumulation;
  }
}
