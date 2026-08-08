import type { Disposable } from "./Disposable";
import { resolveTextureFormat, type TextureFormat } from "./TextureFormat";

export interface TextureDescriptor {
  target?: GLenum;
  source: TexImageSource;
  format?: TextureFormat;
  wrapS?: GLenum;
  wrapT?: GLenum;
  minFilter?: GLenum;
  magFilter?: GLenum;
}

export class Texture implements Disposable {
  readonly handle: WebGLTexture;
  readonly target: GLenum;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    descriptor: TextureDescriptor,
  ) {
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error("Failed to create a WebGL texture.");
    }
    this.handle = texture;
    this.target = descriptor.target ?? gl.TEXTURE_2D;

    const resolved = resolveTextureFormat(gl, descriptor.format ?? "rgba8unorm");

    gl.bindTexture(this.target, texture);
    gl.texImage2D(this.target, 0, resolved.internalFormat, resolved.format, resolved.type, descriptor.source);
    gl.texParameteri(this.target, gl.TEXTURE_WRAP_S, descriptor.wrapS ?? gl.CLAMP_TO_EDGE);
    gl.texParameteri(this.target, gl.TEXTURE_WRAP_T, descriptor.wrapT ?? gl.CLAMP_TO_EDGE);
    gl.texParameteri(this.target, gl.TEXTURE_MIN_FILTER, descriptor.minFilter ?? gl.LINEAR);
    gl.texParameteri(this.target, gl.TEXTURE_MAG_FILTER, descriptor.magFilter ?? gl.LINEAR);
  }

  dispose(): void {
    this.gl.deleteTexture(this.handle);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
