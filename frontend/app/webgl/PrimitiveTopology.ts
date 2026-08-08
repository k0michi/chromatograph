export type PrimitiveTopology = "point-list" | "line-list" | "line-strip" | "triangle-list" | "triangle-strip";

export function resolvePrimitiveTopology(gl: WebGL2RenderingContext, topology: PrimitiveTopology): GLenum {
  switch (topology) {
    case "point-list":
      return gl.POINTS;
    case "line-list":
      return gl.LINES;
    case "line-strip":
      return gl.LINE_STRIP;
    case "triangle-list":
      return gl.TRIANGLES;
    case "triangle-strip":
      return gl.TRIANGLE_STRIP;
    default: {
      const exhaustiveCheck: never = topology;
      throw new Error(`Unknown PrimitiveTopology: ${exhaustiveCheck as string}`);
    }
  }
}
