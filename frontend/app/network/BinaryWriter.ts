export class BinaryWriter {
  private readonly chunks: Uint8Array<ArrayBuffer>[] = [];

  writeUInt32(value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, false);
    this.chunks.push(bytes);
  }

  writeInt32(value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, false);
    this.chunks.push(bytes);
  }

  writeFloat32(value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, false);
    this.chunks.push(bytes);
  }

  writeBytes(value: Uint8Array<ArrayBufferLike>): void {
    this.chunks.push(value.slice());
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    const length = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}
