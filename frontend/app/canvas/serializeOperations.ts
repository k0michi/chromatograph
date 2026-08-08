import { Bytes } from "~/crypto/bytes";
import { Hex } from "~/crypto/hex";
import type { BlendOperation, Operation, UndoOperation } from "./Operation";

export class OperationEncoder {
  private static readonly formatVersion = 1;
  private static readonly blendOperation = 1;
  private static readonly undoOperation = 2;
  private static readonly sha256Bytes = 32;

  static blend(op: BlendOperation): Uint8Array<ArrayBuffer> {
    const parents = op.parents.map((parent) => {
      const bytes = Hex.toBytes(parent);
      if (bytes.length !== this.sha256Bytes) {
        throw new Error("A parent hash must be a 32-byte SHA-256 digest.");
      }
      return bytes;
    });

    return Bytes.concat([
      Bytes.uint32(this.blendOperation),
      Bytes.int32(op.chunk.x),
      Bytes.int32(op.chunk.y),
      Bytes.uint32(parents.length),
      ...parents,
      Bytes.uint32(op.compositeOp),
      Bytes.uint32(op.blendMode),
      Bytes.float32(op.opacity),
      Bytes.uint32(op.imageBytes.length),
      op.imageBytes,
    ]);
  }

  static undo(op: UndoOperation): Uint8Array<ArrayBuffer> {
    const parents = op.parents.map((parent) => {
      const bytes = Hex.toBytes(parent);
      if (bytes.length !== this.sha256Bytes) {
        throw new Error("A parent hash must be a 32-byte SHA-256 digest.");
      }
      return bytes;
    });
    return Bytes.concat([
      Bytes.uint32(this.undoOperation),
      Bytes.int32(op.chunk.x),
      Bytes.int32(op.chunk.y),
      Bytes.uint32(parents.length),
      ...parents,
    ]);
  }

  static operations(operations: readonly Operation[]): Uint8Array<ArrayBuffer> {
    return Bytes.concat([
      Bytes.uint32(this.formatVersion),
      Bytes.uint32(operations.length),
      ...operations.map((operation) => operation.type === "blend" ? this.blend(operation) : this.undo(operation)),
    ]);
  }
}
