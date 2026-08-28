import type { Disposable } from "./Disposable";
import SymbolHelper from "~/polyfills/SymbolHelper";
import { resolveShaderStage, type ShaderStage } from "./ShaderStage";

export interface ShaderDescriptor {
  stage: ShaderStage;
  source: string;
}

export class Shader implements Disposable {
  readonly handle: WebGLShader;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    descriptor: ShaderDescriptor,
  ) {
    const shader = gl.createShader(resolveShaderStage(gl, descriptor.stage));
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

  [SymbolHelper.dispose](): void {
    this.dispose();
  }
}
