import { Bytes } from "~/crypto/bytes";
import { Hex } from "~/crypto/hex";
import { Patch } from "./Patch";
import { OperationDecoder, OperationEncoder } from "./serializeOperations";

export class PatchEncoder {
  private static readonly formatVersion = 1;
  private static readonly publicKeyBytes = 32;
  private static readonly hashBytes = 32;
  private static readonly signatureBytes = 64;

  static encode(patch: Patch): Uint8Array<ArrayBuffer> {
    const operations = OperationEncoder.operations(patch.operations);
    const publicKey = this.fixedHex(patch.publicKeyHex, this.publicKeyBytes, "public key");
    const hash = this.fixedHex(patch.hash, this.hashBytes, "hash");
    const signature = this.fixedHex(patch.signatureHex, this.signatureBytes, "signature");
    return Bytes.concat([
      Bytes.uint32(this.formatVersion),
      Bytes.uint32(operations.length),
      operations,
      publicKey,
      hash,
      signature,
    ]);
  }

  private static fixedHex(value: string, byteCount: number, name: string): Uint8Array<ArrayBuffer> {
    const bytes = Hex.toBytes(value);
    if (bytes.length !== byteCount) {
      throw new Error(`A Patch ${name} must be ${byteCount} bytes.`);
    }
    return bytes;
  }
}

export class PatchDecoder {
  private static readonly formatVersion = 1;
  private static readonly publicKeyBytes = 32;
  private static readonly hashBytes = 32;
  private static readonly signatureBytes = 64;

  static decode(packet: ArrayBuffer | Uint8Array<ArrayBufferLike>): Patch {
    const bytes = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
    const reader = new PatchPacketReader(bytes);
    const version = reader.uint32();
    if (version !== this.formatVersion) {
      throw new Error(`Unsupported Patch packet version: ${version}.`);
    }
    const operations = OperationDecoder.operations(reader.bytes(reader.uint32()));
    const publicKeyHex = Hex.fromBytes(reader.bytes(this.publicKeyBytes));
    const hash = Hex.fromBytes(reader.bytes(this.hashBytes));
    const signatureHex = Hex.fromBytes(reader.bytes(this.signatureBytes));
    if (!reader.isAtEnd) {
      throw new Error(`Patch packet has ${reader.remaining} trailing byte(s).`);
    }
    return Patch.fromEncoded(operations, publicKeyHex, hash, signatureHex);
  }
}

class PatchPacketReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly packet: Uint8Array<ArrayBufferLike>) {
    this.view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  }

  get remaining(): number { return this.packet.byteLength - this.offset; }
  get isAtEnd(): boolean { return this.remaining === 0; }

  uint32(): number {
    this.require(4);
    const value = this.view.getUint32(this.offset, false);
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
      throw new Error("Truncated Patch packet.");
    }
  }
}
