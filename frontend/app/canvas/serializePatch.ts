import { Hex } from "~/crypto/hex";
import { BinaryReader } from "~/network/BinaryReader";
import { BinaryWriter } from "~/network/BinaryWriter";
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
    const writer = new BinaryWriter();
    writer.writeUInt32(this.formatVersion);
    writer.writeUInt32(operations.length);
    writer.writeBytes(operations);
    writer.writeBytes(publicKey);
    writer.writeBytes(hash);
    writer.writeBytes(signature);
    return writer.toBytes();
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
    const reader = new BinaryReader(bytes);
    const version = reader.readUInt32();
    if (version !== this.formatVersion) {
      throw new Error(`Unsupported Patch packet version: ${version}.`);
    }
    const operations = OperationDecoder.operations(reader.readBytes(reader.readUInt32()));
    const publicKeyHex = Hex.fromBytes(reader.readBytes(this.publicKeyBytes));
    const hash = Hex.fromBytes(reader.readBytes(this.hashBytes));
    const signatureHex = Hex.fromBytes(reader.readBytes(this.signatureBytes));
    if (!reader.isAtEnd) {
      throw new Error(`Patch packet has ${reader.remainingByteCount} trailing byte(s).`);
    }
    return Patch.fromEncoded(operations, publicKeyHex, hash, signatureHex);
  }
}
