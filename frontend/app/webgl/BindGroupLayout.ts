export type BindingType = "texture";

export interface BindGroupLayoutEntryDescriptor {
  binding: number;
  type: BindingType;
}

export interface BindGroupLayoutDescriptor {
  entries: BindGroupLayoutEntryDescriptor[];
}

export class BindGroupLayout {
  readonly entries: readonly BindGroupLayoutEntryDescriptor[];

  constructor(descriptor: BindGroupLayoutDescriptor) {
    this.entries = descriptor.entries;
  }
}
