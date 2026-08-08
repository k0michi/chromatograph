export const ShaderStage = {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
} as const;

export type ShaderStage = (typeof ShaderStage)[keyof typeof ShaderStage];

export function resolveShaderStage(gl: WebGL2RenderingContext, stage: ShaderStage): GLenum {
  switch (stage) {
    case ShaderStage.VERTEX:
      return gl.VERTEX_SHADER;
    case ShaderStage.FRAGMENT:
      return gl.FRAGMENT_SHADER;
    case ShaderStage.COMPUTE:
      throw new Error("ShaderStage.COMPUTE has no WebGL2 equivalent (WebGL2 does not support compute shaders).");
    default: {
      const exhaustiveCheck: never = stage;
      throw new Error(`Unknown ShaderStage: ${exhaustiveCheck as number}`);
    }
  }
}
