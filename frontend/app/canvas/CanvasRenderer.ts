import { mat3 } from "gl-matrix";
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
import { QuadGeometry } from "./QuadGeometry";
import { TileStore } from "./TileStore";
import { TILE_SIZE, type Tile, type TileSnapshot } from "./Tile";

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

export interface UncommittedOverlay {
  chunkX: number;
  chunkY: number;
  bindGroup: BindGroup;
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

  commitOperation(tile: Tile, patchHash: string, op: BlendOperation): void {
    tile.addOperation(patchHash, op);
    this.applyToSnapshot(tile, op);
  }

  private applyToSnapshot(tile: Tile, op: BlendOperation): void {
    if (!tile.snapshot) {
      tile.snapshot = this.createEmptySnapshot();
    }
    const mvp = mat3.multiply(mat3.create(), CHUNK_VIEW_PROJECTION, SNAPSHOT_MODEL);
    const pass = this.beginPass({ framebuffer: tile.snapshot.framebuffer, width: TILE_SIZE, height: TILE_SIZE });
    this.drawQuad(pass, mvp, op.bindGroup, op.opacity);
    pass.end();
  }

  private createEmptySnapshot(): TileSnapshot {
    const texture = this.device.createTexture({ source: { width: TILE_SIZE, height: TILE_SIZE, data: null } });
    const framebuffer = this.device.createFramebuffer({ colorAttachment: texture });
    const bindGroup = this.createPatchBindGroup(texture);
    this.beginPass({ framebuffer, width: TILE_SIZE, height: TILE_SIZE }, [0, 0, 0, 0]).end();
    return { texture, bindGroup, framebuffer };
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
        tile.snapshot.texture.dispose();
        tile.snapshot.framebuffer.dispose();
      }
    }
  }
}
