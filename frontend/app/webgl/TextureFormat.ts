export type TextureFormat =
  // 8-bit formats
  | "r8unorm"
  | "r8snorm"
  | "r8uint"
  | "r8sint"
  // 16-bit formats
  | "r16unorm"
  | "r16snorm"
  | "r16uint"
  | "r16sint"
  | "r16float"
  | "rg8unorm"
  | "rg8snorm"
  | "rg8uint"
  | "rg8sint"
  // 32-bit formats
  | "r32uint"
  | "r32sint"
  | "r32float"
  | "rg16unorm"
  | "rg16snorm"
  | "rg16uint"
  | "rg16sint"
  | "rg16float"
  | "rgba8unorm"
  | "rgba8unorm-srgb"
  | "rgba8snorm"
  | "rgba8uint"
  | "rgba8sint"
  | "bgra8unorm"
  | "bgra8unorm-srgb"
  // Packed 32-bit formats
  | "rgb9e5ufloat"
  | "rgb10a2uint"
  | "rgb10a2unorm"
  | "rg11b10ufloat"
  // 64-bit formats
  | "rg32uint"
  | "rg32sint"
  | "rg32float"
  | "rgba16unorm"
  | "rgba16snorm"
  | "rgba16uint"
  | "rgba16sint"
  | "rgba16float"
  // 128-bit formats
  | "rgba32uint"
  | "rgba32sint"
  | "rgba32float"
  // Depth/stencil formats
  | "stencil8"
  | "depth16unorm"
  | "depth24plus"
  | "depth24plus-stencil8"
  | "depth32float"
  | "depth32float-stencil8"
  // BC compressed formats (require WEBGL_compressed_texture_s3tc, not core)
  | "bc1-rgba-unorm"
  | "bc1-rgba-unorm-srgb"
  | "bc2-rgba-unorm"
  | "bc2-rgba-unorm-srgb"
  | "bc3-rgba-unorm"
  | "bc3-rgba-unorm-srgb"
  | "bc4-r-unorm"
  | "bc4-r-snorm"
  | "bc5-rg-unorm"
  | "bc5-rg-snorm"
  | "bc6h-rgb-ufloat"
  | "bc6h-rgb-float"
  | "bc7-rgba-unorm"
  | "bc7-rgba-unorm-srgb"
  // ETC2 compressed formats (require WEBGL_compressed_texture_etc, not core)
  | "etc2-rgb8unorm"
  | "etc2-rgb8unorm-srgb"
  | "etc2-rgb8a1unorm"
  | "etc2-rgb8a1unorm-srgb"
  | "etc2-rgba8unorm"
  | "etc2-rgba8unorm-srgb"
  | "eac-r11unorm"
  | "eac-r11snorm"
  | "eac-rg11unorm"
  | "eac-rg11snorm"
  // ASTC compressed formats (require WEBGL_compressed_texture_astc, not core)
  | "astc-4x4-unorm"
  | "astc-4x4-unorm-srgb"
  | "astc-5x4-unorm"
  | "astc-5x4-unorm-srgb"
  | "astc-5x5-unorm"
  | "astc-5x5-unorm-srgb"
  | "astc-6x5-unorm"
  | "astc-6x5-unorm-srgb"
  | "astc-6x6-unorm"
  | "astc-6x6-unorm-srgb"
  | "astc-8x5-unorm"
  | "astc-8x5-unorm-srgb"
  | "astc-8x6-unorm"
  | "astc-8x6-unorm-srgb"
  | "astc-8x8-unorm"
  | "astc-8x8-unorm-srgb"
  | "astc-10x5-unorm"
  | "astc-10x5-unorm-srgb"
  | "astc-10x6-unorm"
  | "astc-10x6-unorm-srgb"
  | "astc-10x8-unorm"
  | "astc-10x8-unorm-srgb"
  | "astc-10x10-unorm"
  | "astc-10x10-unorm-srgb"
  | "astc-12x10-unorm"
  | "astc-12x10-unorm-srgb"
  | "astc-12x12-unorm"
  | "astc-12x12-unorm-srgb";

export interface ResolvedTextureFormat {
  internalFormat: GLenum;
  format: GLenum;
  type: GLenum;
}

function unsupported(format: TextureFormat, reason: string): never {
  throw new Error(`TextureFormat "${format}" has no WebGL2 core equivalent (${reason}).`);
}

export function resolveTextureFormat(gl: WebGL2RenderingContext, format: TextureFormat): ResolvedTextureFormat {
  switch (format) {
    case "r8unorm":
      return { internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE };
    case "r8snorm":
      return { internalFormat: gl.R8_SNORM, format: gl.RED, type: gl.BYTE };
    case "r8uint":
      return { internalFormat: gl.R8UI, format: gl.RED_INTEGER, type: gl.UNSIGNED_BYTE };
    case "r8sint":
      return { internalFormat: gl.R8I, format: gl.RED_INTEGER, type: gl.BYTE };

    case "r16uint":
      return { internalFormat: gl.R16UI, format: gl.RED_INTEGER, type: gl.UNSIGNED_SHORT };
    case "r16sint":
      return { internalFormat: gl.R16I, format: gl.RED_INTEGER, type: gl.SHORT };
    case "r16float":
      return { internalFormat: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT };
    case "rg8unorm":
      return { internalFormat: gl.RG8, format: gl.RG, type: gl.UNSIGNED_BYTE };
    case "rg8snorm":
      return { internalFormat: gl.RG8_SNORM, format: gl.RG, type: gl.BYTE };
    case "rg8uint":
      return { internalFormat: gl.RG8UI, format: gl.RG_INTEGER, type: gl.UNSIGNED_BYTE };
    case "rg8sint":
      return { internalFormat: gl.RG8I, format: gl.RG_INTEGER, type: gl.BYTE };
    case "r16unorm":
    case "r16snorm":
      return unsupported(format, "requires the EXT_texture_norm16 extension");

    case "r32uint":
      return { internalFormat: gl.R32UI, format: gl.RED_INTEGER, type: gl.UNSIGNED_INT };
    case "r32sint":
      return { internalFormat: gl.R32I, format: gl.RED_INTEGER, type: gl.INT };
    case "r32float":
      return { internalFormat: gl.R32F, format: gl.RED, type: gl.FLOAT };
    case "rg16uint":
      return { internalFormat: gl.RG16UI, format: gl.RG_INTEGER, type: gl.UNSIGNED_SHORT };
    case "rg16sint":
      return { internalFormat: gl.RG16I, format: gl.RG_INTEGER, type: gl.SHORT };
    case "rg16float":
      return { internalFormat: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT };
    case "rgba8unorm":
      return { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    case "rgba8unorm-srgb":
      return { internalFormat: gl.SRGB8_ALPHA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    case "rgba8snorm":
      return { internalFormat: gl.RGBA8_SNORM, format: gl.RGBA, type: gl.BYTE };
    case "rgba8uint":
      return { internalFormat: gl.RGBA8UI, format: gl.RGBA_INTEGER, type: gl.UNSIGNED_BYTE };
    case "rgba8sint":
      return { internalFormat: gl.RGBA8I, format: gl.RGBA_INTEGER, type: gl.BYTE };
    case "rg16unorm":
    case "rg16snorm":
      return unsupported(format, "requires the EXT_texture_norm16 extension");
    case "bgra8unorm":
    case "bgra8unorm-srgb":
      return unsupported(format, "WebGL2 has no BGRA-ordered texture format");

    case "rgb9e5ufloat":
      return { internalFormat: gl.RGB9_E5, format: gl.RGB, type: gl.FLOAT };
    case "rgb10a2uint":
      return { internalFormat: gl.RGB10_A2UI, format: gl.RGBA_INTEGER, type: gl.UNSIGNED_INT_2_10_10_10_REV };
    case "rgb10a2unorm":
      return { internalFormat: gl.RGB10_A2, format: gl.RGBA, type: gl.UNSIGNED_INT_2_10_10_10_REV };
    case "rg11b10ufloat":
      return { internalFormat: gl.R11F_G11F_B10F, format: gl.RGB, type: gl.UNSIGNED_INT_10F_11F_11F_REV };

    case "rg32uint":
      return { internalFormat: gl.RG32UI, format: gl.RG_INTEGER, type: gl.UNSIGNED_INT };
    case "rg32sint":
      return { internalFormat: gl.RG32I, format: gl.RG_INTEGER, type: gl.INT };
    case "rg32float":
      return { internalFormat: gl.RG32F, format: gl.RG, type: gl.FLOAT };
    case "rgba16uint":
      return { internalFormat: gl.RGBA16UI, format: gl.RGBA_INTEGER, type: gl.UNSIGNED_SHORT };
    case "rgba16sint":
      return { internalFormat: gl.RGBA16I, format: gl.RGBA_INTEGER, type: gl.SHORT };
    case "rgba16float":
      return { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    case "rgba16unorm":
    case "rgba16snorm":
      return unsupported(format, "requires the EXT_texture_norm16 extension");

    case "rgba32uint":
      return { internalFormat: gl.RGBA32UI, format: gl.RGBA_INTEGER, type: gl.UNSIGNED_INT };
    case "rgba32sint":
      return { internalFormat: gl.RGBA32I, format: gl.RGBA_INTEGER, type: gl.INT };
    case "rgba32float":
      return { internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT };

    case "stencil8":
      return unsupported(format, "WebGL2 only supports stencil-only as a renderbuffer, not a texture");
    case "depth16unorm":
      return { internalFormat: gl.DEPTH_COMPONENT16, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_SHORT };
    case "depth24plus":
      return { internalFormat: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT };
    case "depth24plus-stencil8":
      return { internalFormat: gl.DEPTH24_STENCIL8, format: gl.DEPTH_STENCIL, type: gl.UNSIGNED_INT_24_8 };
    case "depth32float":
      return { internalFormat: gl.DEPTH_COMPONENT32F, format: gl.DEPTH_COMPONENT, type: gl.FLOAT };
    case "depth32float-stencil8":
      return {
        internalFormat: gl.DEPTH32F_STENCIL8,
        format: gl.DEPTH_STENCIL,
        type: gl.FLOAT_32_UNSIGNED_INT_24_8_REV,
      };

    case "bc1-rgba-unorm":
    case "bc1-rgba-unorm-srgb":
    case "bc2-rgba-unorm":
    case "bc2-rgba-unorm-srgb":
    case "bc3-rgba-unorm":
    case "bc3-rgba-unorm-srgb":
    case "bc4-r-unorm":
    case "bc4-r-snorm":
    case "bc5-rg-unorm":
    case "bc5-rg-snorm":
    case "bc6h-rgb-ufloat":
    case "bc6h-rgb-float":
    case "bc7-rgba-unorm":
    case "bc7-rgba-unorm-srgb":
      return unsupported(format, "requires the WEBGL_compressed_texture_s3tc/bptc extension");

    case "etc2-rgb8unorm":
    case "etc2-rgb8unorm-srgb":
    case "etc2-rgb8a1unorm":
    case "etc2-rgb8a1unorm-srgb":
    case "etc2-rgba8unorm":
    case "etc2-rgba8unorm-srgb":
    case "eac-r11unorm":
    case "eac-r11snorm":
    case "eac-rg11unorm":
    case "eac-rg11snorm":
      return unsupported(format, "requires the WEBGL_compressed_texture_etc extension");

    case "astc-4x4-unorm":
    case "astc-4x4-unorm-srgb":
    case "astc-5x4-unorm":
    case "astc-5x4-unorm-srgb":
    case "astc-5x5-unorm":
    case "astc-5x5-unorm-srgb":
    case "astc-6x5-unorm":
    case "astc-6x5-unorm-srgb":
    case "astc-6x6-unorm":
    case "astc-6x6-unorm-srgb":
    case "astc-8x5-unorm":
    case "astc-8x5-unorm-srgb":
    case "astc-8x6-unorm":
    case "astc-8x6-unorm-srgb":
    case "astc-8x8-unorm":
    case "astc-8x8-unorm-srgb":
    case "astc-10x5-unorm":
    case "astc-10x5-unorm-srgb":
    case "astc-10x6-unorm":
    case "astc-10x6-unorm-srgb":
    case "astc-10x8-unorm":
    case "astc-10x8-unorm-srgb":
    case "astc-10x10-unorm":
    case "astc-10x10-unorm-srgb":
    case "astc-12x10-unorm":
    case "astc-12x10-unorm-srgb":
    case "astc-12x12-unorm":
    case "astc-12x12-unorm-srgb":
      return unsupported(format, "requires the WEBGL_compressed_texture_astc extension");

    default: {
      const exhaustiveCheck: never = format;
      throw new Error(`Unknown TextureFormat: ${exhaustiveCheck as string}`);
    }
  }
}
