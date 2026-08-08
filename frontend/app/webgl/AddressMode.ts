// Mirrors WebGPU's GPUAddressMode. All three values map cleanly to WebGL2.
export type AddressMode = "clamp-to-edge" | "repeat" | "mirror-repeat";

export function resolveAddressMode(gl: WebGL2RenderingContext, mode: AddressMode): GLenum {
  switch (mode) {
    case "clamp-to-edge":
      return gl.CLAMP_TO_EDGE;
    case "repeat":
      return gl.REPEAT;
    case "mirror-repeat":
      return gl.MIRRORED_REPEAT;
    default: {
      const exhaustiveCheck: never = mode;
      throw new Error(`Unknown AddressMode: ${exhaustiveCheck as string}`);
    }
  }
}
