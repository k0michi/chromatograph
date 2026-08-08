import type { Disposable } from "./Disposable";

export interface BufferDescriptor {
  data: BufferSource;
  usage: GLenum;
}

export class Buffer implements Disposable {
  readonly handle: WebGLBuffer;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    descriptor: BufferDescriptor,
  ) {
    const buffer = gl.createBuffer();
    if (!buffer) {
      throw new Error("Failed to create a WebGL buffer.");
    }
    this.handle = buffer;

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, descriptor.data, descriptor.usage);
  }

  /** @internal */
  bind(target: GLenum): void {
    this.gl.bindBuffer(target, this.handle);
  }

  dispose(): void {
    this.gl.deleteBuffer(this.handle);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
