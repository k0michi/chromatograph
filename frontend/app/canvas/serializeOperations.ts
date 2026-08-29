import { decode, encode, rfc8949EncodeOptions } from "cborg";
import { Hex } from "~/crypto/hex";
import { BlendMode, CompositeOp, type Operation } from "./Operation";

type CborValue = number | Uint8Array | CborValue[];
const BLEND = 0;
const UNDO = 1;
const HASH_BYTES = 32;

export interface PatchPayloadValue {
  readonly version: number;
  readonly publicKeyHex: string;
  readonly timestamp: number;
  readonly operations: readonly Operation[];
}

export function encodeCbor(value: CborValue): Uint8Array<ArrayBuffer> {
  return encode(value, rfc8949EncodeOptions) as Uint8Array<ArrayBuffer>;
}

export function decodeCbor(bytes: Uint8Array<ArrayBufferLike>): unknown {
  return decode(bytes, { strict: true, allowIndefinite: false, allowNaN: false, allowInfinity: false });
}

export class OperationEncoder {
  static value(operation: Operation): CborValue[] {
    if (operation.type === "undo") return [UNDO, hash(operation.targetPatchHash, "target Patch hash")];
    assertInt32(operation.chunk.x, "chunk x");
    assertInt32(operation.chunk.y, "chunk y");
    if (!Number.isInteger(operation.opacity) || operation.opacity < 0 || operation.opacity > 255) {
      throw new Error("Opacity must be an unsigned 8-bit integer.");
    }
    return [
      BLEND,
      hash(operation.parent, "parent Patch hash"),
      operation.chunk.x,
      operation.chunk.y,
      operation.compositeOp,
      operation.blendMode,
      operation.opacity,
      hash(operation.payloadHash, "payload hash"),
    ];
  }

  static values(operations: readonly Operation[]): CborValue[] {
    return operations.map((operation) => this.value(operation));
  }
}

export class PatchPayloadEncoder {
  static value(payload: PatchPayloadValue): CborValue[] {
    return [payload.version, hash(payload.publicKeyHex, "public key"), payload.timestamp, OperationEncoder.values(payload.operations)];
  }

  static encode(payload: PatchPayloadValue): Uint8Array<ArrayBuffer> {
    return encodeCbor(this.value(payload));
  }
}

export class OperationDecoder {
  static values(values: unknown[]): readonly Operation[] {
    return values.map((item, index) => {
      const fields = cborArray(item, `operation ${index}`);
      const type = cborUnsigned(fields[0], `operation ${index} type`);
      if (type === UNDO) {
        if (fields.length !== 2) throw new Error(`Undo operation ${index} must contain 2 fields.`);
        return { type: "undo", targetPatchHash: Hex.fromBytes(cborBytes(fields[1], "target Patch hash", HASH_BYTES)) };
      }
      if (type !== BLEND || fields.length !== 8) throw new Error(`Invalid Blend operation ${index}.`);
      const compositeOp = cborUnsigned(fields[4], "composite operation");
      const blendMode = cborUnsigned(fields[5], "blend mode");
      if (!Object.values(CompositeOp).includes(compositeOp)) throw new Error(`Invalid composite operation: ${compositeOp}.`);
      if (!Object.values(BlendMode).includes(blendMode)) throw new Error(`Invalid blend mode: ${blendMode}.`);
      const opacity = cborUnsigned(fields[6], "opacity");
      if (opacity > 255) throw new Error("Opacity must fit in 8 bits.");
      return {
        type: "blend",
        parent: Hex.fromBytes(cborBytes(fields[1], "parent Patch hash", HASH_BYTES)),
        chunk: { x: cborInt32(fields[2], "chunk x"), y: cborInt32(fields[3], "chunk y") },
        compositeOp: compositeOp as CompositeOp,
        blendMode: blendMode as BlendMode,
        opacity,
        payloadHash: Hex.fromBytes(cborBytes(fields[7], "payload hash", HASH_BYTES)),
      };
    });
  }
}

export function cborArray(value: unknown, name: string, length?: number): unknown[] {
  if (!Array.isArray(value) || (length !== undefined && value.length !== length)) {
    throw new Error(`${name} must be a CBOR array${length === undefined ? "" : ` of length ${length}`}.`);
  }
  return value;
}

export function cborUnsigned(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be an unsigned safe integer.`);
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

function hash(value: string, name: string): Uint8Array<ArrayBuffer> {
  const bytes = Hex.toBytes(value);
  if (bytes.length !== HASH_BYTES) throw new Error(`${name} must contain 32 bytes.`);
  return bytes;
}

function assertInt32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new Error(`${name} must be int32.`);
}
