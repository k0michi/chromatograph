import { Device } from "./Device";
import type { Framebuffer } from "./Framebuffer";
import { RenderPassEncoder } from "./RenderPassEncoder";

export interface ContextDescriptor {
  alpha?: boolean;
  antialias?: boolean;
}

export interface RenderPassTarget {
  framebuffer: Framebuffer;
  width: number;
  height: number;
}

export interface RenderPassDescriptor {
  clearColor?: [number, number, number, number];
  target?: RenderPassTarget;
}

export class Context {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly device: Device;

  constructor(canvas: HTMLCanvasElement, descriptor: ContextDescriptor = {}) {
    const gl = canvas.getContext("webgl2", {
      alpha: descriptor.alpha ?? false,
      antialias: descriptor.antialias ?? true,
    });
    if (!gl) {
      throw new Error("WebGL2 is not supported by this browser.");
    }
    this.canvas = canvas;
    this.gl = gl;
    this.device = new Device(gl);
  }

  resize(): boolean {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width === width && this.canvas.height === height) {
      return false;
    }
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
    return true;
  }

  private clear(r: number, g: number, b: number, a: number): void {
    const { gl } = this;
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  beginRenderPass(descriptor: RenderPassDescriptor = {}): RenderPassEncoder {
    const { gl } = this;
    if (descriptor.target) {
      descriptor.target.framebuffer.bind();
      gl.viewport(0, 0, descriptor.target.width, descriptor.target.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    if (descriptor.clearColor) {
      this.clear(...descriptor.clearColor);
    }
    return new RenderPassEncoder(gl);
  }
}
