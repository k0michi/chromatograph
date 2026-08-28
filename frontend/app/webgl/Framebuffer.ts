import type { Disposable } from "./Disposable";
import SymbolHelper from "~/polyfills/SymbolHelper";
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

  readRgba8Async(width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
    const { gl } = this;
    const byteLength = width * height * 4;
    const buffer = gl.createBuffer();
    const sync = (() => {
      if (!buffer) return null;
      this.bind();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLength, gl.STREAM_READ);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      return gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    })();

    if (!buffer || !sync) {
      if (buffer) gl.deleteBuffer(buffer);
      return Promise.reject(new Error("Failed to create an asynchronous framebuffer readback."));
    }
    gl.flush();

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        gl.deleteSync(sync);
        gl.deleteBuffer(buffer);
      };
      const poll = () => {
        const status = gl.clientWaitSync(sync, 0, 0);
        if (status === gl.TIMEOUT_EXPIRED) {
          requestAnimationFrame(poll);
          return;
        }
        if (status === gl.WAIT_FAILED) {
          cleanup();
          reject(new Error("Asynchronous framebuffer readback failed."));
          return;
        }

        const pixels = new Uint8Array(byteLength);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        cleanup();
        resolve(pixels);
      };
      requestAnimationFrame(poll);
    });
  }

  // TODO: proper abstraction
  readRgba8Pixel(x: number, y: number): [number, number, number, number] {
    this.bind();
    const pixel = new Uint8Array(4);
    this.gl.readPixels(x, y, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
    return [pixel[0], pixel[1], pixel[2], pixel[3]];
  }

  async readRgba8PixelAsync(x: number, y: number): Promise<[number, number, number, number]> {
    const { gl } = this;
    const buffer = gl.createBuffer();
    const sync = (() => {
      if (!buffer) return null;
      this.bind();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, 4, gl.STREAM_READ);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      return gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    })();
    if (!buffer || !sync) {
      if (buffer) gl.deleteBuffer(buffer);
      throw new Error("Failed to create an asynchronous pixel readback.");
    }
    gl.flush();

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        gl.deleteSync(sync);
        gl.deleteBuffer(buffer);
      };
      const poll = () => {
        const status = gl.clientWaitSync(sync, 0, 0);
        if (status === gl.TIMEOUT_EXPIRED) {
          requestAnimationFrame(poll);
          return;
        }
        if (status === gl.WAIT_FAILED) {
          cleanup();
          reject(new Error("Asynchronous pixel readback failed."));
          return;
        }
        const pixel = new Uint8Array(4);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixel);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        cleanup();
        resolve([pixel[0], pixel[1], pixel[2], pixel[3]]);
      };
      requestAnimationFrame(poll);
    });
  }

  dispose(): void {
    this.gl.deleteFramebuffer(this.handle);
  }

  [SymbolHelper.dispose](): void {
    this.dispose();
  }
}
