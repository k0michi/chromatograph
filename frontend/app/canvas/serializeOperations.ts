import { decode, encode, rfc8949EncodeOptions } from "cborg";
import { Hex } from "~/crypto/hex";
import { PACKET_VERSION } from "~/network/PacketVersion";
import { BlendMode, CompositeOp, type BlendOperation, type Operation, type UndoOperation } from "./Operation";

type CborValue = number | Uint8Array | CborValue[];

const BLEND_OPERATION = 1;
const UNDO_OPERATION = 2;
const SHA256_BYTES = 32;

export function encodeCbor(value: CborValue): Uint8Array<ArrayBuffer> {
  return encode(value, rfc8949EncodeOptions) as Uint8Array<ArrayBuffer>;
}

export function decodeCbor(bytes: Uint8Array<ArrayBufferLike>): unknown {
  return decode(bytes, {
    strict: true,
    allowIndefinite: false,
    allowNaN: false,
    allowInfinity: false,
  });
}

export class OperationEncoder {
  static blend(op: BlendOperation): CborValue[] {
    return [
      BLEND_OPERATION,
      op.chunk.x,
      op.chunk.y,
      this.parents(op.parents),
      op.compositeOp,
      op.blendMode,
      float32Bits(op.opacity),
      op.imageBytes,
    ];
  }

  static undo(op: UndoOperation): CborValue[] {
    return [UNDO_OPERATION, op.chunk.x, op.chunk.y, this.parents(op.parents)];
  }

  static values(operations: readonly Operation[]): CborValue[] {
    return operations.map((operation) =>
      operation.type === "blend" ? this.blend(operation) : this.undo(operation));
  }

  static operations(operations: readonly Operation[]): Uint8Array<ArrayBuffer> {
    return encodeCbor([PACKET_VERSION, this.values(operations)]);
  }

  private static parents(parents: readonly string[]): Uint8Array[] {
    return parents.map((parent) => {
      const bytes = Hex.toBytes(parent);
      if (bytes.length !== SHA256_BYTES) {
        throw new Error("A parent hash must be a 32-byte SHA-256 digest.");
      }
      return bytes;
    });
  }
}

export class OperationDecoder {
  static operations(packet: ArrayBuffer | Uint8Array<ArrayBufferLike>): readonly Operation[] {
    const value = decodeCbor(packet instanceof Uint8Array ? packet : new Uint8Array(packet));
    const document = cborArray(value, "operation document", 2);
    const version = cborUnsigned(document[0], "operation version");
    if (version !== PACKET_VERSION) throw new Error(`Unsupported operation packet version: ${version}.`);
    return this.values(cborArray(document[1], "operations"));
  }

  static values(values: unknown[]): readonly Operation[] {
    return values.map((value, index) => this.operation(cborArray(value, `operation ${index}`), index));
  }

  private static operation(value: unknown[], index: number): Operation {
    const type = cborUnsigned(value[0], `operation ${index} type`);
    const expectedLength = type === BLEND_OPERATION ? 8 : type === UNDO_OPERATION ? 4 : 0;
    if (expectedLength === 0) throw new Error(`Invalid operation type: ${type}.`);
    if (value.length !== expectedLength) {
      throw new Error(`Operation ${index} must contain ${expectedLength} fields.`);
    }
    const chunk = {
      x: cborInt32(value[1], `operation ${index} chunk x`),
      y: cborInt32(value[2], `operation ${index} chunk y`),
    };
    const parents = cborArray(value[3], `operation ${index} parents`).map((parent) => {
      const bytes = cborBytes(parent, "parent hash", SHA256_BYTES);
      return Hex.fromBytes(bytes);
    });

    if (type === UNDO_OPERATION) return { type: "undo", chunk, parents };
    const compositeOp = cborUnsigned(value[4], "composite operation");
    if (!Object.values(CompositeOp).includes(compositeOp)) {
      throw new Error(`Invalid composite operation: ${compositeOp}.`);
    }
    const blendMode = cborUnsigned(value[5], "blend mode");
    if (!Object.values(BlendMode).includes(blendMode)) throw new Error(`Invalid blend mode: ${blendMode}.`);
    return {
      type: "blend",
      chunk,
      parents,
      compositeOp: compositeOp as CompositeOp,
      blendMode: blendMode as BlendMode,
      opacity: float32FromBits(cborUnsigned(value[6], "opacity bits")),
      imageBytes: cborBytes(value[7], "image bytes"),
    };
  }
}

export function cborArray(value: unknown, name: string, length?: number): unknown[] {
  if (!Array.isArray(value) || (length !== undefined && value.length !== length)) {
    throw new Error(`${name} must be a CBOR array${length === undefined ? "" : ` of length ${length}`}.`);
  }
  return value;
}

export function cborUnsigned(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

export function cborInt32(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new Error(`${name} must be a signed 32-bit integer.`);
  }
  return value;
}

export function cborBytes(value: unknown, name: string, length?: number): Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array) || (length !== undefined && value.length !== length)) {
    throw new Error(`${name} must be a CBOR byte string${length === undefined ? "" : ` of length ${length}`}.`);
  }
  return value.slice() as Uint8Array<ArrayBuffer>;
}

function float32Bits(value: number): number {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value, false);
  return view.getUint32(0, false);
}

function float32FromBits(value: number): number {
  if (value > 0xffffffff) throw new Error("opacity bits must fit in 32 bits.");
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, value, false);
  return view.getFloat32(0, false);
}
