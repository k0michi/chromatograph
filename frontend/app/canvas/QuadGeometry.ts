import type { Buffer } from "~/webgl/Buffer";
import { BufferUsage } from "~/webgl/BufferUsage";
import type { Device } from "~/webgl/Device";
import type { Disposable } from "~/webgl/Disposable";
import SymbolHelper from "~/polyfills/SymbolHelper";

export class QuadGeometry implements Disposable {
  readonly buffer: Buffer;
  readonly vertexCount = 4;

  constructor(device: Device) {
    // x, y, u, v
    const vertices = new Float32Array([
      0, 0, 0, 0,
      1, 0, 1, 0,
      0, 1, 0, 1,
      1, 1, 1, 1,
    ]);
    this.buffer = device.createBuffer({ data: vertices, usage: BufferUsage.VERTEX });
  }

  dispose(): void {
    this.buffer.dispose();
  }

  [SymbolHelper.dispose](): void {
    this.dispose();
  }
}
