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

  dispose(): void {
    this.gl.deleteFramebuffer(this.handle);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
