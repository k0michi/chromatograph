import { Hex } from "~/crypto/hex";
import { Sha256 } from "~/crypto/sha256";
import { PATCH_FORMAT_VERSION, Patch } from "./Patch";
import {
  cborArray, cborBytes, cborUnsigned, decodeCbor, encodeCbor,
  OperationDecoder, PatchPayloadEncoder,
} from "./serializeOperations";

export class PatchEncoder {
  static encode(patch: Patch): Uint8Array<ArrayBuffer> {
    const payload = PatchPayloadEncoder.value({ version: PATCH_FORMAT_VERSION, ...patch });
    return encodeCbor([[payload, fixedHex(patch.signatureHex, 64, "signature")], patch.images.map((image) => image.slice())]);
  }
}

export class PatchDecoder {
  static decode(packet: ArrayBuffer | Uint8Array<ArrayBufferLike>): Patch {
    const bytes = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
    const root = cborArray(decodeCbor(bytes), "Patch", 2);
    const partial = cborArray(root[0], "PartialPatch", 2);
    const payload = cborArray(partial[0], "PartialPatchPayload", 4);
    const version = cborUnsigned(payload[0], "version");
    if (version !== PATCH_FORMAT_VERSION) throw new Error(`Unsupported Patch version: ${version}.`);
    const publicKeyHex = Hex.fromBytes(cborBytes(payload[1], "public key", 32));
    const timestamp = cborUnsigned(payload[2], "timestamp");
    const operations = OperationDecoder.values(cborArray(payload[3], "operations"));
    const signatureHex = Hex.fromBytes(cborBytes(partial[1], "signature", 64));
    const images = cborArray(root[1], "images").map((image) => cborBytes(image, "image"));
    const payloadBytes = PatchPayloadEncoder.encode({ version, publicKeyHex, timestamp, operations });
    const hashPromise = Sha256.digestSync(payloadBytes);
    const hash = Hex.fromBytes(hashPromise);
    validateImages(operations, images);
    return Patch.fromEncoded(operations, publicKeyHex, timestamp, signatureHex, images, hash);
  }
}

function fixedHex(value: string, count: number, name: string): Uint8Array<ArrayBuffer> {
  const bytes = Hex.toBytes(value);
  if (bytes.length !== count) throw new Error(`${name} must contain ${count} bytes.`);
  return bytes;
}

function validateImages(operations: Patch["operations"], images: readonly Uint8Array<ArrayBuffer>[]): void {
  const expected = [...new Set(operations.filter((op) => op.type === "blend").map((op) => op.payloadHash))].sort();
  if (expected.length !== images.length) throw new Error("Patch images do not exactly match referenced payload hashes.");
  for (let index = 0; index < images.length; index++) {
    const actual = Hex.fromBytes(Sha256.digestSync(images[index]));
    if (actual !== expected[index]) throw new Error("Patch images are not strictly hash-sorted or do not match their payload hashes.");
  }
}
