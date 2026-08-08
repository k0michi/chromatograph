import { resolveAddressMode, type AddressMode } from "./AddressMode";
import type { Disposable } from "./Disposable";
import { resolveFilterMode, type FilterMode } from "./FilterMode";
import type { MipmapFilterMode } from "./MipmapFilterMode";
import { resolveTextureFormat, type TextureFormat } from "./TextureFormat";

export interface RawImageSource {
  width: number;
  height: number;
  data: ArrayBufferView;
}

export interface TextureDescriptor {
  target?: GLenum;
  source: TexImageSource | RawImageSource;
  format?: TextureFormat;
  wrapS?: AddressMode;
  wrapT?: AddressMode;
  minFilter?: FilterMode;
  magFilter?: FilterMode;
  mipmapFilter?: MipmapFilterMode;
}

function isRawImageSource(source: TexImageSource | RawImageSource): source is RawImageSource {
  return typeof source === "object" && source !== null && "data" in source;
}

function resolveMinFilter(
  gl: WebGL2RenderingContext,
  minFilter: FilterMode,
  mipmapFilter: MipmapFilterMode | undefined,
): GLenum {
  if (!mipmapFilter) {
    return resolveFilterMode(gl, minFilter);
  }
  if (minFilter === "nearest") {
    return mipmapFilter === "nearest" ? gl.NEAREST_MIPMAP_NEAREST : gl.NEAREST_MIPMAP_LINEAR;
  }
  return mipmapFilter === "nearest" ? gl.LINEAR_MIPMAP_NEAREST : gl.LINEAR_MIPMAP_LINEAR;
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

    const resolvedFormat = resolveTextureFormat(gl, descriptor.format ?? "rgba8unorm");

    gl.bindTexture(this.target, texture);
    if (isRawImageSource(descriptor.source)) {
      gl.texImage2D(
        this.target,
        0,
        resolvedFormat.internalFormat,
        descriptor.source.width,
        descriptor.source.height,
        0,
        resolvedFormat.format,
        resolvedFormat.type,
        descriptor.source.data,
      );
    } else {
      gl.texImage2D(
        this.target,
        0,
        resolvedFormat.internalFormat,
        resolvedFormat.format,
        resolvedFormat.type,
        descriptor.source,
      );
    }
    gl.texParameteri(this.target, gl.TEXTURE_WRAP_S, resolveAddressMode(gl, descriptor.wrapS ?? "clamp-to-edge"));
    gl.texParameteri(this.target, gl.TEXTURE_WRAP_T, resolveAddressMode(gl, descriptor.wrapT ?? "clamp-to-edge"));
    gl.texParameteri(
      this.target,
      gl.TEXTURE_MIN_FILTER,
      resolveMinFilter(gl, descriptor.minFilter ?? "linear", descriptor.mipmapFilter),
    );
    gl.texParameteri(this.target, gl.TEXTURE_MAG_FILTER, resolveFilterMode(gl, descriptor.magFilter ?? "linear"));

    if (descriptor.mipmapFilter) {
      gl.generateMipmap(this.target);
    }
  }

  dispose(): void {
    this.gl.deleteTexture(this.handle);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
