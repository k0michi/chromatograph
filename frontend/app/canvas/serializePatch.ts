import { Hex } from "~/crypto/hex";
import { PACKET_VERSION } from "~/network/PacketVersion";
import { Patch } from "./Patch";
import {
  cborArray,
  cborBytes,
  cborUnsigned,
  decodeCbor,
  encodeCbor,
  OperationDecoder,
  OperationEncoder,
} from "./serializeOperations";

export class PatchEncoder {
  private static readonly publicKeyBytes = 32;
  private static readonly hashBytes = 32;
  private static readonly signatureBytes = 64;

  static encode(patch: Patch): Uint8Array<ArrayBuffer> {
    return encodeCbor([
      PACKET_VERSION,
      OperationEncoder.values(patch.operations),
      this.fixedHex(patch.publicKeyHex, this.publicKeyBytes, "public key"),
      this.fixedHex(patch.hash, this.hashBytes, "hash"),
      this.fixedHex(patch.signatureHex, this.signatureBytes, "signature"),
    ]);
  }

  private static fixedHex(value: string, byteCount: number, name: string): Uint8Array<ArrayBuffer> {
    const bytes = Hex.toBytes(value);
    if (bytes.length !== byteCount) throw new Error(`A Patch ${name} must be ${byteCount} bytes.`);
    return bytes;
  }
}

export class PatchDecoder {
  private static readonly publicKeyBytes = 32;
  private static readonly hashBytes = 32;
  private static readonly signatureBytes = 64;

  static decode(packet: ArrayBuffer | Uint8Array<ArrayBufferLike>): Patch {
    const bytes = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
    const document = cborArray(decodeCbor(bytes), "Patch", 5);
    const version = cborUnsigned(document[0], "Patch version");
    if (version !== PACKET_VERSION) throw new Error(`Unsupported Patch packet version: ${version}.`);
    return Patch.fromEncoded(
      OperationDecoder.values(cborArray(document[1], "Patch operations")),
      Hex.fromBytes(cborBytes(document[2], "Patch public key", this.publicKeyBytes)),
      Hex.fromBytes(cborBytes(document[3], "Patch hash", this.hashBytes)),
      Hex.fromBytes(cborBytes(document[4], "Patch signature", this.signatureBytes)),
    );
  }
}
