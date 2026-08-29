import { sha256 } from "@noble/hashes/sha2.js";

export class Sha256 {
  static async digest(data: Uint8Array<ArrayBufferLike>): Promise<Uint8Array<ArrayBuffer>> {
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
    return new Uint8Array(digest);
  }

  /** Synchronous SHA-256 for validating/de-referencing received Patch containers. */
  static digestSync(data: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
    return new Uint8Array(sha256(data));
  }
}
