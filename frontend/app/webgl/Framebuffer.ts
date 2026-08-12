import type { Disposable } from "./Disposable";
import type { Texture } from "./Texture";

export interface FramebufferDescriptor {
  colorAttachment: Texture;
}

export class Framebuffer implements Disposable {
  readonly handle: WebGLFramebuffer;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    descriptor: FramebufferDescriptor,
  ) {
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) {
      throw new Error("Failed to create a WebGL framebuffer.");
    }
    this.handle = framebuffer;

    const { colorAttachment } = descriptor;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, colorAttachment.target, colorAttachment.handle, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer is incomplete (status ${status}).`);
    }
  }

  /** @internal */
  bind(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.handle);
  }

  // TODO: proper abstraction
  readRgba8(width: number, height: number): Uint8Array<ArrayBuffer> {
    this.bind();
    const pixels = new Uint8Array(width * height * 4);
    this.gl.readPixels(0, 0, width, height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  // TODO: proper abstraction
  readRgba8Pixel(x: number, y: number): [number, number, number, number] {
    this.bind();
    const pixel = new Uint8Array(4);
    this.gl.readPixels(x, y, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
    return [pixel[0], pixel[1], pixel[2], pixel[3]];
  }

  dispose(): void {
    this.gl.deleteFramebuffer(this.handle);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
