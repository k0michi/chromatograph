export interface TileChunk {
  readonly x: number;
  readonly y: number;
}

export enum CompositeOp {
  SourceOver = 0,
  DestinationOut = 1,
  SourceIn = 2,
  SourceAtop = 3,
}

export enum BlendMode {
  Normal = 0,
  Multiply = 1,
  Screen = 2,
  Overlay = 3,
}

export const ROOT_PATCH_HASH = "00".repeat(32);

export interface BlendOperation {
  readonly type: "blend";
  readonly chunk: TileChunk;
  readonly parent: string;
  readonly compositeOp: CompositeOp;
  readonly blendMode: BlendMode;
  /** Quantized opacity in the inclusive range 0...255. */
  readonly opacity: number;
  readonly payloadHash: string;
}

/** Local-only input; Patch.create moves the image into Patch.images. */
export interface PendingBlendOperation extends Omit<BlendOperation, "payloadHash"> {
  readonly imageBytes: Uint8Array<ArrayBuffer>;
}

export interface UndoOperation {
  readonly type: "undo";
  readonly targetPatchHash: string;
}

export type Operation = BlendOperation | UndoOperation;
export type PendingOperation = PendingBlendOperation | UndoOperation;
export type RenderableBlendOperation = BlendOperation & { readonly imageBytes: Uint8Array<ArrayBuffer> };
export type RenderableOperation = RenderableBlendOperation | UndoOperation;
