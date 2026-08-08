export class Sha256 {
  static async digest(data: Uint8Array<ArrayBufferLike>): Promise<Uint8Array<ArrayBuffer>> {
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
    return new Uint8Array(digest);
  }
}
