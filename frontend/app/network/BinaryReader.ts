export class BinaryReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly packet: Uint8Array<ArrayBufferLike>) {
    this.view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  }

  static fromArrayBuffer(packet: ArrayBuffer): BinaryReader {
    return new BinaryReader(new Uint8Array(packet));
  }

  get remainingByteCount(): number { return this.packet.byteLength - this.offset; }
  get isAtEnd(): boolean { return this.remainingByteCount === 0; }

  readUInt32(): number {
    this.requireBytes(4);
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readInt32(): number {
    this.requireBytes(4);
    const value = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readFloat32(): number {
    this.requireBytes(4);
    const value = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readBytes(count: number): Uint8Array<ArrayBuffer> {
    this.requireBytes(count);
    const result = this.packet.slice(this.offset, this.offset + count);
    this.offset += count;
    return result;
  }

  private requireBytes(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.remainingByteCount) {
      throw new Error("Unexpected end of binary data.");
    }
  }
}
