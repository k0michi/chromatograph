import type { mat3 } from "gl-matrix";
import { resolveBlendFactor, type BlendFactor } from "./BlendFactor";
import type { BindGroupLayout } from "./BindGroupLayout";
import type { Disposable } from "./Disposable";
import SymbolHelper from "~/polyfills/SymbolHelper";
import { resolvePrimitiveTopology, type PrimitiveTopology } from "./PrimitiveTopology";
import type { Shader } from "./Shader";
import { resolveVertexFormat, type VertexFormat } from "./VertexFormat";

export interface BlendState {
  srcFactor: BlendFactor;
  dstFactor: BlendFactor;
}

export interface VertexAttributeDescriptor {
  shaderLocation: number;
  format: VertexFormat;
  offset: number;
}

export interface VertexBufferLayoutDescriptor {
  arrayStride: number;
  attributes: VertexAttributeDescriptor[];
}

export interface RenderPipelineDescriptor {
  vertexShader: Shader;
  fragmentShader: Shader;
  topology: PrimitiveTopology;
  blend?: BlendState;
  bindGroupLayout: BindGroupLayout;
  vertexBuffers: VertexBufferLayoutDescriptor[];
}

/** @internal */
interface ResolvedBlendState {
  srcFactor: GLenum;
  dstFactor: GLenum;
}

/** @internal */
interface ResolvedVertexAttribute {
  shaderLocation: number;
  offset: number;
  size: number;
  glType: GLenum;
  normalized: boolean;
  integer: boolean;
}

/** @internal */
interface ResolvedVertexBufferLayout {
  arrayStride: number;
  attributes: ResolvedVertexAttribute[];
}

export class RenderPipeline implements Disposable {
  private readonly handle: WebGLProgram;
  private readonly uniformLocations = new Map<string, WebGLUniformLocation>();
  /** @internal */
  readonly topology: GLenum;
  /** @internal */
  readonly blend?: ResolvedBlendState;
  readonly bindGroupLayout: BindGroupLayout;
  /** @internal */
  readonly vertexBuffers: readonly ResolvedVertexBufferLayout[];

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

    this.topology = resolvePrimitiveTopology(gl, descriptor.topology);
    this.blend = descriptor.blend
      ? {
        srcFactor: resolveBlendFactor(gl, descriptor.blend.srcFactor),
        dstFactor: resolveBlendFactor(gl, descriptor.blend.dstFactor),
      }
      : undefined;
    this.bindGroupLayout = descriptor.bindGroupLayout;
    this.vertexBuffers = descriptor.vertexBuffers.map((layout) => ({
      arrayStride: layout.arrayStride,
      attributes: layout.attributes.map((attribute) => {
        const resolved = resolveVertexFormat(gl, attribute.format);
        return {
          shaderLocation: attribute.shaderLocation,
          offset: attribute.offset,
          size: resolved.size,
          glType: resolved.glType,
          normalized: resolved.normalized,
          integer: resolved.integer,
        };
      }),
    }));
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
  setFloat2(name: string, x: number, y: number): void {
    this.gl.uniform2f(this.uniformLocation(name), x, y);
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

  [SymbolHelper.dispose](): void {
    this.dispose();
  }
}
