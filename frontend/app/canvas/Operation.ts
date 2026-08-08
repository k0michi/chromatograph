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

export interface BlendOperation {
  readonly type: "blend";
  readonly chunk: TileChunk;
  readonly parents: readonly string[];
  readonly compositeOp: CompositeOp;
  readonly blendMode: BlendMode;
  readonly opacity: number;
  readonly imageBytes: Uint8Array<ArrayBuffer>;
}

export interface UndoOperation {
  readonly type: "undo";
  readonly chunk: TileChunk;
  readonly parents: readonly string[];
}

export type Operation = BlendOperation | UndoOperation;
