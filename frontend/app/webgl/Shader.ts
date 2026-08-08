import type { Disposable } from "./Disposable";

export interface ShaderDescriptor {
  type: GLenum;
  source: string;
}

export class Shader implements Disposable {
  readonly handle: WebGLShader;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    descriptor: ShaderDescriptor,
  ) {
    const shader = gl.createShader(descriptor.type);
    if (!shader) {
      throw new Error("Failed to create a WebGL shader.");
    }
    this.handle = shader;

    gl.shaderSource(shader, descriptor.source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Failed to compile shader: ${info}`);
    }
  }

  dispose(): void {
    this.gl.deleteShader(this.handle);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
