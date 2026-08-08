import { Buffer } from "~/webgl/Buffer";
import type { Disposable } from "~/webgl/Disposable";

export class QuadGeometry implements Disposable {
  readonly buffer: Buffer;
  readonly vertexCount = 4;

  constructor(gl: WebGL2RenderingContext) {
    // x, y, u, v
    const vertices = new Float32Array([
      0, 0, 0, 0,
      1, 0, 1, 0,
      0, 1, 0, 1,
      1, 1, 1, 1,
    ]);
    this.buffer = new Buffer(gl, { data: vertices, usage: gl.STATIC_DRAW });
  }

  dispose(): void {
    this.buffer.dispose();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
