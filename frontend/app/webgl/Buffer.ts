import { BufferUsage, hasBufferUsage } from "./BufferUsage";
import type { Disposable } from "./Disposable";
import SymbolHelper from "~/polyfills/SymbolHelper";

export interface BufferDescriptor {
  data: BufferSource;
  usage: BufferUsage;
}

function resolveDrawHint(gl: WebGL2RenderingContext, usage: BufferUsage): GLenum {
  return hasBufferUsage(usage, BufferUsage.MAP_WRITE) || hasBufferUsage(usage, BufferUsage.COPY_DST)
    ? gl.DYNAMIC_DRAW
    : gl.STATIC_DRAW;
}

export class Buffer implements Disposable {
  readonly handle: WebGLBuffer;
  readonly usage: BufferUsage;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    descriptor: BufferDescriptor,
  ) {
    const buffer = gl.createBuffer();
    if (!buffer) {
      throw new Error("Failed to create a WebGL buffer.");
    }
    this.handle = buffer;
    this.usage = descriptor.usage;

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, descriptor.data, resolveDrawHint(gl, descriptor.usage));
  }

  /** @internal */
  bind(target: GLenum): void {
    this.gl.bindBuffer(target, this.handle);
  }

  dispose(): void {
    this.gl.deleteBuffer(this.handle);
  }

  [SymbolHelper.dispose](): void {
    this.dispose();
  }
}
