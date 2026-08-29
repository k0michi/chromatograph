import { Hex } from "~/crypto/hex";
import type { Identity } from "~/crypto/Identity";
import { Sha256 } from "~/crypto/sha256";
import type { BlendOperation, Operation, PendingOperation } from "./Operation";
import { PatchPayloadEncoder } from "./serializeOperations";

export const PATCH_FORMAT_VERSION = 0;

export class Patch {
  private constructor(
    readonly operations: readonly Operation[],
    readonly publicKeyHex: string,
    readonly timestamp: number,
    readonly hash: string,
    readonly signatureHex: string,
    readonly images: readonly Uint8Array<ArrayBuffer>[],
  ) { }

  static async create(pending: readonly PendingOperation[], identity: Identity, timestamp = Date.now()): Promise<Patch> {
    const imageByHash = new Map<string, Uint8Array<ArrayBuffer>>();
    const operations: Operation[] = [];
    for (const operation of pending) {
      if (operation.type === "undo") {
        operations.push(operation);
        continue;
      }
      const payloadHash = Hex.fromBytes(await Sha256.digest(operation.imageBytes));
      imageByHash.set(payloadHash, operation.imageBytes.slice());
      const { imageBytes: _, ...metadata } = operation;
      operations.push({ ...metadata, payloadHash });
    }
    const images = [...imageByHash.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, image]) => image);
    const payloadBytes = PatchPayloadEncoder.encode({
      version: PATCH_FORMAT_VERSION, publicKeyHex: identity.publicKeyHex, timestamp, operations,
    });
    const hashBytes = await Sha256.digest(payloadBytes);
    const signatureBytes = await identity.sign(payloadBytes);
    return new Patch(operations, identity.publicKeyHex, timestamp, Hex.fromBytes(hashBytes), Hex.fromBytes(signatureBytes), images);
  }

  static fromEncoded(
    operations: readonly Operation[],
    publicKeyHex: string,
    timestamp: number,
    signatureHex: string,
    images: readonly Uint8Array<ArrayBuffer>[],
    hash: string,
  ): Patch {
    return new Patch(operations, publicKeyHex, timestamp, hash, signatureHex, images);
  }

  imageFor(operation: BlendOperation): Uint8Array<ArrayBuffer> {
    const hashes = [...new Set(this.operations
      .filter((candidate): candidate is BlendOperation => candidate.type === "blend")
      .map((candidate) => candidate.payloadHash))].sort();
    const index = hashes.indexOf(operation.payloadHash);
    if (index < 0 || !this.images[index]) throw new Error(`Missing image ${operation.payloadHash}.`);
    return this.images[index].slice();
  }
}
