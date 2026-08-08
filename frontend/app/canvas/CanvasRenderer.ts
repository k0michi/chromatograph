import { mat3 } from "gl-matrix";
import { Identity } from "~/crypto/Identity";
import type { BindGroup } from "~/webgl/BindGroup";
import type { BindGroupLayout } from "~/webgl/BindGroupLayout";
import { Context, type RenderPassTarget } from "~/webgl/Context";
import type { Device } from "~/webgl/Device";
import type { RenderPassEncoder } from "~/webgl/RenderPassEncoder";
import type { RenderPipeline } from "~/webgl/RenderPipeline";
import { ShaderStage } from "~/webgl/ShaderStage";
import type { Texture } from "~/webgl/Texture";
import { Camera2D } from "./Camera2D";
import { CHUNK_VIEW_PROJECTION } from "./chunkSpace";
import type { BlendOperation } from "./Operation";
import { Patch } from "./Patch";
import { QuadGeometry } from "./QuadGeometry";
import { TileStore } from "./TileStore";
import { TILE_SIZE, type Tile, type TileOperationEntry, type TileSnapshot } from "./Tile";

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aUv;

uniform mat3 uMvp;

out vec2 vUv;

void main() {
  vUv = aUv;
  vec3 clip = uMvp * vec3(aPosition, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
uniform sampler2D uImage;
uniform float uOpacity;

out vec4 outColor;

void main() {
  outColor = texture(uImage, vUv) * uOpacity;
}
`;

const BACKGROUND_COLOR: [number, number, number, number] = [1, 1, 1, 1];
const IMAGE_BINDING = 0;
const SNAPSHOT_MODEL = mat3.fromValues(TILE_SIZE, 0, 0, 0, TILE_SIZE, 0, 0, 0, 1);
const SNAPSHOT_MVP = mat3.multiply(mat3.create(), CHUNK_VIEW_PROJECTION, SNAPSHOT_MODEL);

export interface UncommittedOverlay {
  chunkX: number;
  chunkY: number;
  bindGroup: BindGroup;
}

interface HistoryRecord {
  patch: Patch;
  entries: { tile: Tile; entry: TileOperationEntry }[];
}

export class CanvasRenderer {
  private readonly context: Context;
  private readonly pipeline: RenderPipeline;
  private readonly quad: QuadGeometry;
  private readonly bindGroupLayout: BindGroupLayout;
  readonly gl: WebGL2RenderingContext;
  readonly device: Device;
  readonly camera = new Camera2D();
  readonly tiles = new TileStore();
  readonly uncommittedOverlays = new Map<string, UncommittedOverlay>();

  private readonly undoStack: HistoryRecord[] = [];
  private readonly redoStack: HistoryRecord[] = [];
  private readonly identity: Promise<Identity> = Identity.generate();

  constructor(canvas: HTMLCanvasElement) {
    this.context = new Context(canvas);
    this.gl = this.context.gl;
    this.device = this.context.device;
    const { gl, device } = this;

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: IMAGE_BINDING, type: "texture" }],
    });

    const vertexShader = device.createShader({ stage: ShaderStage.VERTEX, source: VERTEX_SHADER });
    const fragmentShader = device.createShader({ stage: ShaderStage.FRAGMENT, source: FRAGMENT_SHADER });
    try {
      this.pipeline = device.createRenderPipeline({
        vertexShader,
        fragmentShader,
        topology: "triangle-strip",
        blend: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
        bindGroupLayout: this.bindGroupLayout,
        vertexBuffers: [
          {
            arrayStride: 4 * Float32Array.BYTES_PER_ELEMENT,
            attributes: [
              { shaderLocation: 0, format: "float32x2", offset: 0 },
              { shaderLocation: 1, format: "float32x2", offset: 2 * Float32Array.BYTES_PER_ELEMENT },
            ],
          },
        ],
      });
    } finally {
      vertexShader.dispose();
      fragmentShader.dispose();
    }

    this.quad = new QuadGeometry(device);
  }

  createPatchBindGroup(texture: Texture): BindGroup {
    return this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [{ binding: IMAGE_BINDING, texture }],
    });
  }

  beginPass(target?: RenderPassTarget, clearColor?: [number, number, number, number]): RenderPassEncoder {
    const pass = this.context.beginRenderPass({ clearColor, target });
    pass.setPipeline(this.pipeline);
    pass.setVertexBuffer(0, this.quad.buffer);
    pass.setUniformInt("uImage", IMAGE_BINDING);
    return pass;
  }

  drawQuad(pass: RenderPassEncoder, mvp: mat3, bindGroup: BindGroup, opacity: number): void {
    pass.setUniformMatrix3("uMvp", mvp);
    pass.setBindGroup(bindGroup);
    pass.setUniformFloat("uOpacity", opacity);
    pass.draw(this.quad.vertexCount);
  }

  private paintOntoSnapshot(snapshot: TileSnapshot, bindGroup: BindGroup, opacity: number): void {
    const pass = this.beginPass({ framebuffer: snapshot.framebuffer, width: TILE_SIZE, height: TILE_SIZE });
    this.drawQuad(pass, SNAPSHOT_MVP, bindGroup, opacity);
    pass.end();
  }

  private createEmptySnapshot(): TileSnapshot {
    const texture = this.device.createTexture({ source: { width: TILE_SIZE, height: TILE_SIZE, data: null } });
    const framebuffer = this.device.createFramebuffer({ colorAttachment: texture });
    const bindGroup = this.createPatchBindGroup(texture);
    this.beginPass({ framebuffer, width: TILE_SIZE, height: TILE_SIZE }, [0, 0, 0, 0]).end();
    return { texture, bindGroup, framebuffer };
  }

  private disposeSnapshot(snapshot: TileSnapshot): void {
    snapshot.texture.dispose();
    snapshot.framebuffer.dispose();
  }

  async commitPatch(operations: readonly BlendOperation[]): Promise<void> {
    const patch = await Patch.create(operations, await this.identity);
    const entries: HistoryRecord["entries"] = [];

    for (const operation of operations) {
      const tile = this.tiles.getOrCreate(operation.chunk.x, operation.chunk.y);
      const entry = tile.addOperation(patch.hash, operation);
      if (!tile.snapshot) {
        tile.snapshot = this.createEmptySnapshot();
      }
      this.paintOntoSnapshot(tile.snapshot, operation.bindGroup, operation.opacity);
      entries.push({ tile, entry });
    }

    this.undoStack.push({ patch, entries });
    this.redoStack.length = 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const record = this.undoStack.pop();
    if (!record) {
      return;
    }
    const tiles = new Set<Tile>();
    for (const { tile, entry } of record.entries) {
      entry.active = false;
      tiles.add(tile);
    }
    for (const tile of tiles) {
      this.rebuildSnapshot(tile);
    }
    this.redoStack.push(record);
  }

  redo(): void {
    const record = this.redoStack.pop();
    if (!record) {
      return;
    }
    const tiles = new Set<Tile>();
    for (const { tile, entry } of record.entries) {
      entry.active = true;
      tiles.add(tile);
    }
    for (const tile of tiles) {
      this.rebuildSnapshot(tile);
    }
    this.undoStack.push(record);
  }

  private rebuildSnapshot(tile: Tile): void {
    const rebuilt = this.createEmptySnapshot();
    for (const entry of tile.operationEntries) {
      if (entry.active) {
        this.paintOntoSnapshot(rebuilt, entry.op.bindGroup, entry.op.opacity);
      }
    }
    if (tile.snapshot) {
      this.disposeSnapshot(tile.snapshot);
    }
    tile.snapshot = rebuilt;
  }

  render(): void {
    this.resize();

    const pass = this.beginPass(undefined, BACKGROUND_COLOR);

    const viewProjection = this.camera.getViewProjectionMatrix();
    const bounds = this.camera.visibleWorldBounds();

    for (const tile of this.tiles) {
      if (!tile.snapshot) {
        continue;
      }
      const tileMinX = tile.x * TILE_SIZE;
      const tileMinY = tile.y * TILE_SIZE;
      const isVisible =
        tileMinX < bounds.maxX &&
        tileMinX + TILE_SIZE > bounds.minX &&
        tileMinY < bounds.maxY &&
        tileMinY + TILE_SIZE > bounds.minY;
      if (!isVisible) {
        continue;
      }

      const model = mat3.fromValues(TILE_SIZE, 0, 0, 0, TILE_SIZE, 0, tileMinX, tileMinY, 1);
      const mvp = mat3.multiply(mat3.create(), viewProjection, model);
      this.drawQuad(pass, mvp, tile.snapshot.bindGroup, 1);
    }

    for (const overlay of this.uncommittedOverlays.values()) {
      const tileMinX = overlay.chunkX * TILE_SIZE;
      const tileMinY = overlay.chunkY * TILE_SIZE;
      const isVisible =
        tileMinX < bounds.maxX &&
        tileMinX + TILE_SIZE > bounds.minX &&
        tileMinY < bounds.maxY &&
        tileMinY + TILE_SIZE > bounds.minY;
      if (!isVisible) {
        continue;
      }

      const model = mat3.fromValues(TILE_SIZE, 0, 0, 0, TILE_SIZE, 0, tileMinX, tileMinY, 1);
      const mvp = mat3.multiply(mat3.create(), viewProjection, model);
      this.drawQuad(pass, mvp, overlay.bindGroup, 1);
    }

    pass.end();
  }

  private resize(): void {
    if (this.context.resize()) {
      this.camera.resize(this.context.canvas.clientWidth, this.context.canvas.clientHeight);
    }
  }

  dispose(): void {
    this.quad.dispose();
    this.pipeline.dispose();
    const disposedTextures = new Set<Texture>();
    for (const tile of this.tiles) {
      for (const entry of tile.operationEntries) {
        if (!disposedTextures.has(entry.op.texture)) {
          disposedTextures.add(entry.op.texture);
          entry.op.texture.dispose();
        }
      }
      if (tile.snapshot) {
        this.disposeSnapshot(tile.snapshot);
      }
    }
  }
}
