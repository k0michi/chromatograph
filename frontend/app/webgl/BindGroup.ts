import type { BindGroupLayout } from "./BindGroupLayout";
import type { Texture } from "./Texture";

export interface BindGroupEntryDescriptor {
  binding: number;
  texture: Texture;
}

export interface BindGroupDescriptor {
  layout: BindGroupLayout;
  entries: BindGroupEntryDescriptor[];
}

export class BindGroup {
  readonly layout: BindGroupLayout;
  private readonly entries: readonly BindGroupEntryDescriptor[];

  constructor(descriptor: BindGroupDescriptor) {
    this.layout = descriptor.layout;
    this.entries = descriptor.entries;

    for (const layoutEntry of this.layout.entries) {
      const entry = this.entries.find((candidate) => candidate.binding === layoutEntry.binding);
      if (!entry) {
        throw new Error(`BindGroup is missing an entry for binding ${layoutEntry.binding}.`);
      }
    }
  }

  /** @internal */
  apply(gl: WebGL2RenderingContext): void {
    for (const entry of this.entries) {
      gl.activeTexture(gl.TEXTURE0 + entry.binding);
      gl.bindTexture(entry.texture.target, entry.texture.handle);
    }
  }
}
