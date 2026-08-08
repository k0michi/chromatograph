import { Bytes } from "~/crypto/bytes";
import { Hex } from "~/crypto/hex";
import { BlendMode, CompositeOp, type BlendOperation, type Operation, type UndoOperation } from "./Operation";

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

export class OperationDecoder {
  private static readonly formatVersion = 1;
  private static readonly blendOperation = 1;
  private static readonly undoOperation = 2;
  private static readonly sha256Bytes = 32;

  static operations(packet: ArrayBuffer | Uint8Array<ArrayBufferLike>): readonly Operation[] {
    const bytes = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
    const reader = new OperationPacketReader(bytes);
    const version = reader.uint32();
    if (version !== this.formatVersion) {
      throw new Error(`Unsupported operation packet version: ${version}.`);
    }

    const count = reader.uint32();
    const operations: Operation[] = [];
    for (let index = 0; index < count; index++) {
      const type = reader.uint32();
      const chunk = { x: reader.int32(), y: reader.int32() };
      const parentCount = reader.uint32();
      const parents: string[] = [];
      for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
        parents.push(Hex.fromBytes(reader.bytes(this.sha256Bytes)));
      }

      if (type === this.blendOperation) {
        const compositeOp = reader.uint32();
        if (!Object.values(CompositeOp).includes(compositeOp)) {
          throw new Error(`Invalid composite operation: ${compositeOp}.`);
        }
        const blendMode = reader.uint32();
        if (!Object.values(BlendMode).includes(blendMode)) {
          throw new Error(`Invalid blend mode: ${blendMode}.`);
        }
        const opacity = reader.float32();
        const imageBytes = reader.bytes(reader.uint32());
        operations.push({
          type: "blend",
          chunk,
          parents,
          compositeOp: compositeOp as CompositeOp,
          blendMode: blendMode as BlendMode,
          opacity,
          imageBytes,
        });
      } else if (type === this.undoOperation) {
        operations.push({ type: "undo", chunk, parents });
      } else {
        throw new Error(`Invalid operation type: ${type}.`);
      }
    }

    if (!reader.isAtEnd) {
      throw new Error(`Operation packet has ${reader.remaining} trailing byte(s).`);
    }
    return operations;
  }
}

class OperationPacketReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly packet: Uint8Array<ArrayBufferLike>) {
    this.view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  }

  get remaining(): number {
    return this.packet.byteLength - this.offset;
  }

  get isAtEnd(): boolean {
    return this.remaining === 0;
  }

  uint32(): number {
    this.require(4);
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  int32(): number {
    this.require(4);
    const value = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return value;
  }

  float32(): number {
    this.require(4);
    const value = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return value;
  }

  bytes(count: number): Uint8Array<ArrayBuffer> {
    this.require(count);
    const result = this.packet.slice(this.offset, this.offset + count);
    this.offset += count;
    return result;
  }

  private require(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.remaining) {
      throw new Error("Truncated operation packet.");
    }
  }
}
