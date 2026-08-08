export type FilterMode = "nearest" | "linear";

export function resolveFilterMode(gl: WebGL2RenderingContext, mode: FilterMode): GLenum {
  switch (mode) {
    case "nearest":
      return gl.NEAREST;
    case "linear":
      return gl.LINEAR;
    default: {
      const exhaustiveCheck: never = mode;
      throw new Error(`Unknown FilterMode: ${exhaustiveCheck as string}`);
    }
  }
}
