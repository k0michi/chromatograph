import type { mat3 } from "gl-matrix";
import type { BindGroup } from "./BindGroup";
import type { Buffer } from "./Buffer";
import { BufferUsage, hasBufferUsage } from "./BufferUsage";
import type { RenderPipeline } from "./RenderPipeline";

export class RenderPassEncoder {
  private currentPipeline: RenderPipeline | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) { }

  setPipeline(pipeline: RenderPipeline): void {
    const { gl } = this;
    this.currentPipeline = pipeline;
    pipeline.use();
    if (pipeline.blend) {
      gl.enable(gl.BLEND);
      gl.blendFunc(pipeline.blend.srcFactor, pipeline.blend.dstFactor);
    } else {
      gl.disable(gl.BLEND);
    }
  }

  setVertexBuffer(slot: number, buffer: Buffer): void {
    const { gl } = this;
    const layout = this.requirePipeline().vertexBuffers[slot];
    if (!layout) {
      throw new Error(`No vertex buffer layout declared for slot ${slot}.`);
    }
    if (!hasBufferUsage(buffer.usage, BufferUsage.VERTEX)) {
      throw new Error("setVertexBuffer() was passed a Buffer that was not created with BufferUsage.VERTEX.");
    }
    buffer.bind(gl.ARRAY_BUFFER);
    for (const attribute of layout.attributes) {
      gl.enableVertexAttribArray(attribute.shaderLocation);
      if (attribute.integer) {
        gl.vertexAttribIPointer(
          attribute.shaderLocation,
          attribute.size,
          attribute.glType,
          layout.arrayStride,
          attribute.offset,
        );
      } else {
        gl.vertexAttribPointer(
          attribute.shaderLocation,
          attribute.size,
          attribute.glType,
          attribute.normalized,
          layout.arrayStride,
          attribute.offset,
        );
      }
    }
  }

  setBindGroup(bindGroup: BindGroup): void {
    const pipeline = this.requirePipeline();
    if (bindGroup.layout !== pipeline.bindGroupLayout) {
      throw new Error("BindGroup's layout does not match the current pipeline's bind group layout.");
    }
    bindGroup.apply(this.gl);
  }

  setUniformMatrix3(name: string, value: mat3): void {
    this.requirePipeline().setMatrix3(name, value);
  }

  setUniformFloat(name: string, value: number): void {
    this.requirePipeline().setFloat(name, value);
  }

  setUniformInt(name: string, value: number): void {
    this.requirePipeline().setInt(name, value);
  }

  draw(vertexCount: number, firstVertex = 0): void {
    const pipeline = this.requirePipeline();
    this.gl.drawArrays(pipeline.topology, firstVertex, vertexCount);
  }

  end(): void {
    this.currentPipeline = null;
  }

  private requirePipeline(): RenderPipeline {
    if (!this.currentPipeline) {
      throw new Error("No pipeline is set on this render pass. Call setPipeline() first.");
    }
    return this.currentPipeline;
  }
}
