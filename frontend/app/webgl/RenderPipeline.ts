import type { mat3 } from "gl-matrix";
import type { BindGroupLayout } from "./BindGroupLayout";
import type { Disposable } from "./Disposable";
import type { Shader } from "./Shader";

export interface BlendState {
  srcFactor: GLenum;
  dstFactor: GLenum;
}

export interface VertexAttributeDescriptor {
  shaderLocation: number;
  size: number;
  type: GLenum;
  offset: number;
}

export interface VertexBufferLayoutDescriptor {
  arrayStride: number;
  attributes: VertexAttributeDescriptor[];
}

export interface RenderPipelineDescriptor {
  vertexShader: Shader;
  fragmentShader: Shader;
  topology: GLenum;
  blend?: BlendState;
  bindGroupLayout: BindGroupLayout;
  vertexBuffers: VertexBufferLayoutDescriptor[];
}

export class RenderPipeline implements Disposable {
  private readonly handle: WebGLProgram;
  private readonly uniformLocations = new Map<string, WebGLUniformLocation>();
  readonly topology: GLenum;
  readonly blend?: BlendState;
  readonly bindGroupLayout: BindGroupLayout;
  readonly vertexBuffers: readonly VertexBufferLayoutDescriptor[];

  constructor(
    private readonly gl: WebGL2RenderingContext,
    descriptor: RenderPipelineDescriptor,
  ) {
    const program = gl.createProgram();
    if (!program) {
      throw new Error("Failed to create a WebGL program.");
    }
    this.handle = program;

    gl.attachShader(program, descriptor.vertexShader.handle);
    gl.attachShader(program, descriptor.fragmentShader.handle);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Failed to link WebGL program: ${info}`);
    }

    this.topology = descriptor.topology;
    this.blend = descriptor.blend;
    this.bindGroupLayout = descriptor.bindGroupLayout;
    this.vertexBuffers = descriptor.vertexBuffers;
  }

  /** @internal */
  use(): void {
    this.gl.useProgram(this.handle);
  }

  /** @internal */
  setMatrix3(name: string, value: mat3): void {
    this.gl.uniformMatrix3fv(this.uniformLocation(name), false, value);
  }

  /** @internal */
  setFloat(name: string, value: number): void {
    this.gl.uniform1f(this.uniformLocation(name), value);
  }

  /** @internal */
  setInt(name: string, value: number): void {
    this.gl.uniform1i(this.uniformLocation(name), value);
  }

  private uniformLocation(name: string): WebGLUniformLocation {
    let location = this.uniformLocations.get(name);
    if (location === undefined) {
      const found = this.gl.getUniformLocation(this.handle, name);
      if (!found) {
        throw new Error(`Uniform "${name}" was not found (or was optimized out).`);
      }
      location = found;
      this.uniformLocations.set(name, location);
    }
    return location;
  }

  dispose(): void {
    this.gl.deleteProgram(this.handle);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
