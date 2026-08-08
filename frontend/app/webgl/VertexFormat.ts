// Mirrors WebGPU's GPUVertexFormat.
export type VertexFormat =
  | "uint8"
  | "uint8x2"
  | "uint8x4"
  | "sint8"
  | "sint8x2"
  | "sint8x4"
  | "unorm8"
  | "unorm8x2"
  | "unorm8x4"
  | "snorm8"
  | "snorm8x2"
  | "snorm8x4"
  | "uint16"
  | "uint16x2"
  | "uint16x4"
  | "sint16"
  | "sint16x2"
  | "sint16x4"
  | "unorm16"
  | "unorm16x2"
  | "unorm16x4"
  | "snorm16"
  | "snorm16x2"
  | "snorm16x4"
  | "float16"
  | "float16x2"
  | "float16x4"
  | "float32"
  | "float32x2"
  | "float32x3"
  | "float32x4"
  | "uint32"
  | "uint32x2"
  | "uint32x3"
  | "uint32x4"
  | "sint32"
  | "sint32x2"
  | "sint32x3"
  | "sint32x4"
  | "unorm10-10-10-2"
  | "unorm8x4-bgra";

export interface ResolvedVertexFormat {
  size: number;
  glType: GLenum;
  normalized: boolean;
  integer: boolean;
}

export function resolveVertexFormat(gl: WebGL2RenderingContext, format: VertexFormat): ResolvedVertexFormat {
  switch (format) {
    case "uint8":
      return { size: 1, glType: gl.UNSIGNED_BYTE, normalized: false, integer: true };
    case "uint8x2":
      return { size: 2, glType: gl.UNSIGNED_BYTE, normalized: false, integer: true };
    case "uint8x4":
      return { size: 4, glType: gl.UNSIGNED_BYTE, normalized: false, integer: true };
    case "sint8":
      return { size: 1, glType: gl.BYTE, normalized: false, integer: true };
    case "sint8x2":
      return { size: 2, glType: gl.BYTE, normalized: false, integer: true };
    case "sint8x4":
      return { size: 4, glType: gl.BYTE, normalized: false, integer: true };
    case "unorm8":
      return { size: 1, glType: gl.UNSIGNED_BYTE, normalized: true, integer: false };
    case "unorm8x2":
      return { size: 2, glType: gl.UNSIGNED_BYTE, normalized: true, integer: false };
    case "unorm8x4":
      return { size: 4, glType: gl.UNSIGNED_BYTE, normalized: true, integer: false };
    case "snorm8":
      return { size: 1, glType: gl.BYTE, normalized: true, integer: false };
    case "snorm8x2":
      return { size: 2, glType: gl.BYTE, normalized: true, integer: false };
    case "snorm8x4":
      return { size: 4, glType: gl.BYTE, normalized: true, integer: false };
    case "uint16":
      return { size: 1, glType: gl.UNSIGNED_SHORT, normalized: false, integer: true };
    case "uint16x2":
      return { size: 2, glType: gl.UNSIGNED_SHORT, normalized: false, integer: true };
    case "uint16x4":
      return { size: 4, glType: gl.UNSIGNED_SHORT, normalized: false, integer: true };
    case "sint16":
      return { size: 1, glType: gl.SHORT, normalized: false, integer: true };
    case "sint16x2":
      return { size: 2, glType: gl.SHORT, normalized: false, integer: true };
    case "sint16x4":
      return { size: 4, glType: gl.SHORT, normalized: false, integer: true };
    case "unorm16":
      return { size: 1, glType: gl.UNSIGNED_SHORT, normalized: true, integer: false };
    case "unorm16x2":
      return { size: 2, glType: gl.UNSIGNED_SHORT, normalized: true, integer: false };
    case "unorm16x4":
      return { size: 4, glType: gl.UNSIGNED_SHORT, normalized: true, integer: false };
    case "snorm16":
      return { size: 1, glType: gl.SHORT, normalized: true, integer: false };
    case "snorm16x2":
      return { size: 2, glType: gl.SHORT, normalized: true, integer: false };
    case "snorm16x4":
      return { size: 4, glType: gl.SHORT, normalized: true, integer: false };
    case "float16":
      return { size: 1, glType: gl.HALF_FLOAT, normalized: false, integer: false };
    case "float16x2":
      return { size: 2, glType: gl.HALF_FLOAT, normalized: false, integer: false };
    case "float16x4":
      return { size: 4, glType: gl.HALF_FLOAT, normalized: false, integer: false };
    case "float32":
      return { size: 1, glType: gl.FLOAT, normalized: false, integer: false };
    case "float32x2":
      return { size: 2, glType: gl.FLOAT, normalized: false, integer: false };
    case "float32x3":
      return { size: 3, glType: gl.FLOAT, normalized: false, integer: false };
    case "float32x4":
      return { size: 4, glType: gl.FLOAT, normalized: false, integer: false };
    case "uint32":
      return { size: 1, glType: gl.UNSIGNED_INT, normalized: false, integer: true };
    case "uint32x2":
      return { size: 2, glType: gl.UNSIGNED_INT, normalized: false, integer: true };
    case "uint32x3":
      return { size: 3, glType: gl.UNSIGNED_INT, normalized: false, integer: true };
    case "uint32x4":
      return { size: 4, glType: gl.UNSIGNED_INT, normalized: false, integer: true };
    case "sint32":
      return { size: 1, glType: gl.INT, normalized: false, integer: true };
    case "sint32x2":
      return { size: 2, glType: gl.INT, normalized: false, integer: true };
    case "sint32x3":
      return { size: 3, glType: gl.INT, normalized: false, integer: true };
    case "sint32x4":
      return { size: 4, glType: gl.INT, normalized: false, integer: true };
    case "unorm10-10-10-2":
      return { size: 4, glType: gl.UNSIGNED_INT_2_10_10_10_REV, normalized: true, integer: false };
    case "unorm8x4-bgra":
      throw new Error(`VertexFormat "${format}" has no WebGL2 equivalent (no BGRA vertex attribute format).`);
    default: {
      const exhaustiveCheck: never = format;
      throw new Error(`Unknown VertexFormat: ${exhaustiveCheck as string}`);
    }
  }
}
