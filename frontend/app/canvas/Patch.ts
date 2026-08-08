import type { BlendOperation } from "./Operation";

let nextLocalPatchId = 0;

export class Patch {
  readonly hash: string;

  constructor(readonly operations: readonly BlendOperation[]) {
    this.hash = `local-${(nextLocalPatchId++).toString(36).padStart(8, "0")}`;
  }
}
