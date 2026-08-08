import { BindGroup, type BindGroupDescriptor } from "./BindGroup";
import { BindGroupLayout, type BindGroupLayoutDescriptor } from "./BindGroupLayout";
import { Buffer, type BufferDescriptor } from "./Buffer";
import { Framebuffer, type FramebufferDescriptor } from "./Framebuffer";
import { RenderPipeline, type RenderPipelineDescriptor } from "./RenderPipeline";
import { Shader, type ShaderDescriptor } from "./Shader";
import { Texture, type TextureDescriptor } from "./Texture";

export class Device {
  constructor(private readonly gl: WebGL2RenderingContext) { }

  createBuffer(descriptor: BufferDescriptor): Buffer {
    return new Buffer(this.gl, descriptor);
  }

  createTexture(descriptor: TextureDescriptor): Texture {
    return new Texture(this.gl, descriptor);
  }

  createFramebuffer(descriptor: FramebufferDescriptor): Framebuffer {
    return new Framebuffer(this.gl, descriptor);
  }

  createShader(descriptor: ShaderDescriptor): Shader {
    return new Shader(this.gl, descriptor);
  }

  createRenderPipeline(descriptor: RenderPipelineDescriptor): RenderPipeline {
    return new RenderPipeline(this.gl, descriptor);
  }

  createBindGroupLayout(descriptor: BindGroupLayoutDescriptor): BindGroupLayout {
    return new BindGroupLayout(descriptor);
  }

  createBindGroup(descriptor: BindGroupDescriptor): BindGroup {
    return new BindGroup(descriptor);
  }
}
