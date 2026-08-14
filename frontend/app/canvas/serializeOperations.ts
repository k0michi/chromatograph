import { Hex } from "~/crypto/hex";
import { BinaryReader } from "~/network/BinaryReader";
import { BinaryWriter } from "~/network/BinaryWriter";
import { PACKET_VERSION } from "~/network/PacketVersion";
import { BlendMode, CompositeOp, type BlendOperation, type Operation, type UndoOperation } from "./Operation";

export class OperationEncoder {
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

    const writer = new BinaryWriter();
    writer.writeUInt32(this.blendOperation);
    writer.writeInt32(op.chunk.x);
    writer.writeInt32(op.chunk.y);
    writer.writeUInt32(parents.length);
    for (const parent of parents) writer.writeBytes(parent);
    writer.writeUInt32(op.compositeOp);
    writer.writeUInt32(op.blendMode);
    writer.writeFloat32(op.opacity);
    writer.writeUInt32(op.imageBytes.length);
    writer.writeBytes(op.imageBytes);
    return writer.toBytes();
  }

  static undo(op: UndoOperation): Uint8Array<ArrayBuffer> {
    const parents = op.parents.map((parent) => {
      const bytes = Hex.toBytes(parent);
      if (bytes.length !== this.sha256Bytes) {
        throw new Error("A parent hash must be a 32-byte SHA-256 digest.");
      }
      return bytes;
    });
    const writer = new BinaryWriter();
    writer.writeUInt32(this.undoOperation);
    writer.writeInt32(op.chunk.x);
    writer.writeInt32(op.chunk.y);
    writer.writeUInt32(parents.length);
    for (const parent of parents) writer.writeBytes(parent);
    return writer.toBytes();
  }

  static operations(operations: readonly Operation[]): Uint8Array<ArrayBuffer> {
    const writer = new BinaryWriter();
    writer.writeUInt32(PACKET_VERSION);
    writer.writeUInt32(operations.length);
    for (const operation of operations) {
      writer.writeBytes(operation.type === "blend" ? this.blend(operation) : this.undo(operation));
    }
    return writer.toBytes();
  }
}

export class OperationDecoder {
  private static readonly blendOperation = 1;
  private static readonly undoOperation = 2;
  private static readonly sha256Bytes = 32;

  static operations(packet: ArrayBuffer | Uint8Array<ArrayBufferLike>): readonly Operation[] {
    const bytes = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
    const reader = new BinaryReader(bytes);
    const version = reader.readUInt32();
    if (version !== PACKET_VERSION) {
      throw new Error(`Unsupported operation packet version: ${version}.`);
    }

    const count = reader.readUInt32();
    const operations: Operation[] = [];
    for (let index = 0; index < count; index++) {
      const type = reader.readUInt32();
      const chunk = { x: reader.readInt32(), y: reader.readInt32() };
      const parentCount = reader.readUInt32();
      const parents: string[] = [];
      for (let parentIndex = 0; parentIndex < parentCount; parentIndex++) {
        parents.push(Hex.fromBytes(reader.readBytes(this.sha256Bytes)));
      }

      if (type === this.blendOperation) {
        const compositeOp = reader.readUInt32();
        if (!Object.values(CompositeOp).includes(compositeOp)) {
          throw new Error(`Invalid composite operation: ${compositeOp}.`);
        }
        const blendMode = reader.readUInt32();
        if (!Object.values(BlendMode).includes(blendMode)) {
          throw new Error(`Invalid blend mode: ${blendMode}.`);
        }
        const opacity = reader.readFloat32();
        const imageBytes = reader.readBytes(reader.readUInt32());
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
      throw new Error(`Operation packet has ${reader.remainingByteCount} trailing byte(s).`);
    }
    return operations;
  }
}
