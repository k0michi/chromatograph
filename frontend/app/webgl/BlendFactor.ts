export type BlendFactor =
  | "zero"
  | "one"
  | "src"
  | "one-minus-src"
  | "src-alpha"
  | "one-minus-src-alpha"
  | "dst"
  | "one-minus-dst"
  | "dst-alpha"
  | "one-minus-dst-alpha"
  | "src-alpha-saturated"
  | "constant"
  | "one-minus-constant"
  | "src1"
  | "one-minus-src1"
  | "src1-alpha"
  | "one-minus-src1-alpha";

export function resolveBlendFactor(gl: WebGL2RenderingContext, factor: BlendFactor): GLenum {
  switch (factor) {
    case "zero":
      return gl.ZERO;
    case "one":
      return gl.ONE;
    case "src":
      return gl.SRC_COLOR;
    case "one-minus-src":
      return gl.ONE_MINUS_SRC_COLOR;
    case "src-alpha":
      return gl.SRC_ALPHA;
    case "one-minus-src-alpha":
      return gl.ONE_MINUS_SRC_ALPHA;
    case "dst":
      return gl.DST_COLOR;
    case "one-minus-dst":
      return gl.ONE_MINUS_DST_COLOR;
    case "dst-alpha":
      return gl.DST_ALPHA;
    case "one-minus-dst-alpha":
      return gl.ONE_MINUS_DST_ALPHA;
    case "src-alpha-saturated":
      return gl.SRC_ALPHA_SATURATE;
    case "constant":
      return gl.CONSTANT_COLOR;
    case "one-minus-constant":
      return gl.ONE_MINUS_CONSTANT_COLOR;
    case "src1":
    case "one-minus-src1":
    case "src1-alpha":
    case "one-minus-src1-alpha":
      throw new Error(
        `BlendFactor "${factor}" has no WebGL2 core equivalent (dual-source blending requires the EXT_blend_func_extended extension).`,
      );
    default: {
      const exhaustiveCheck: never = factor;
      throw new Error(`Unknown BlendFactor: ${exhaustiveCheck as string}`);
    }
  }
}
