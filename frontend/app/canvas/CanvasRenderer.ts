import { mat3 } from "gl-matrix";
import type { BindGroup } from "~/webgl/BindGroup";
import type { BindGroupLayout } from "~/webgl/BindGroupLayout";
import { Context } from "~/webgl/Context";
import type { Device } from "~/webgl/Device";
import type { RenderPipeline } from "~/webgl/RenderPipeline";
import type { Texture } from "~/webgl/Texture";
import { Camera2D } from "./Camera2D";
import { QuadGeometry } from "./QuadGeometry";
import { TileStore } from "./TileStore";
import { TILE_SIZE } from "./Tile";

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

const BACKGROUND_COLOR: [number, number, number, number] = [0.09, 0.09, 0.11, 1];
const IMAGE_BINDING = 0;

export class CanvasRenderer {
  private readonly context: Context;
  private readonly pipeline: RenderPipeline;
  private readonly quad: QuadGeometry;
  private readonly bindGroupLayout: BindGroupLayout;
  readonly gl: WebGL2RenderingContext;
  readonly device: Device;
  readonly camera = new Camera2D();
  readonly tiles = new TileStore();

  constructor(canvas: HTMLCanvasElement) {
    this.context = new Context(canvas);
    this.gl = this.context.gl;
    this.device = this.context.device;
    const { gl, device } = this;

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: IMAGE_BINDING, type: "texture" }],
    });

    const vertexShader = device.createShader({ type: gl.VERTEX_SHADER, source: VERTEX_SHADER });
    const fragmentShader = device.createShader({ type: gl.FRAGMENT_SHADER, source: FRAGMENT_SHADER });
    try {
      this.pipeline = device.createRenderPipeline({
        vertexShader,
        fragmentShader,
        topology: gl.TRIANGLE_STRIP,
        blend: { srcFactor: gl.SRC_ALPHA, dstFactor: gl.ONE_MINUS_SRC_ALPHA },
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

    this.quad = new QuadGeometry(device, gl);
  }

  createPatchBindGroup(texture: Texture): BindGroup {
    return this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [{ binding: IMAGE_BINDING, texture }],
    });
  }

  private resize(): void {
    if (this.context.resize()) {
      this.camera.resize(this.context.canvas.clientWidth, this.context.canvas.clientHeight);
    }
  }

  render(): void {
    this.resize();

    const pass = this.context.beginRenderPass({ clearColor: BACKGROUND_COLOR });
    pass.setPipeline(this.pipeline);
    pass.setVertexBuffer(0, this.quad.buffer);
    pass.setUniformInt("uImage", IMAGE_BINDING);

    const viewProjection = this.camera.getViewProjectionMatrix();
    const bounds = this.camera.visibleWorldBounds();

    for (const tile of this.tiles) {
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
      pass.setUniformMatrix3("uMvp", mvp);

      for (const patch of tile.patches) {
        pass.setBindGroup(patch.bindGroup);
        pass.setUniformFloat("uOpacity", patch.opacity);
        pass.draw(this.quad.vertexCount);
      }
    }

    pass.end();
  }

  dispose(): void {
    this.quad.dispose();
    this.pipeline.dispose();
    for (const tile of this.tiles) {
      for (const patch of tile.patches) {
        patch.texture.dispose();
      }
    }
  }
}
