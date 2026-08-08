export class Bytes {
  static concat(chunks: readonly Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBuffer> {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  static uint32(value: number): Uint8Array<ArrayBuffer> {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setUint32(0, value, false);
    return new Uint8Array(buffer);
  }

  static int32(value: number): Uint8Array<ArrayBuffer> {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setInt32(0, value, false);
    return new Uint8Array(buffer);
  }

  static float32(value: number): Uint8Array<ArrayBuffer> {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setFloat32(0, value, false);
    return new Uint8Array(buffer);
  }
}
