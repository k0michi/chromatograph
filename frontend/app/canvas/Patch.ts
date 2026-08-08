import type { BindGroup } from "~/webgl/BindGroup";
import type { Texture } from "~/webgl/Texture";

export class Patch {
  constructor(
    readonly texture: Texture,
    readonly bindGroup: BindGroup,
    readonly opacity: number = 1,
  ) { }
}
