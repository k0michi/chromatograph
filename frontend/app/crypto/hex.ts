export class Hex {
  static fromBytes(bytes: Uint8Array<ArrayBufferLike>): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  static toBytes(hex: string): Uint8Array<ArrayBuffer> {
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
      throw new Error("Invalid hex string.");
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
}
