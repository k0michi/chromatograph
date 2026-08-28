import { decode, encode } from "fast-png";

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array<ArrayBuffer>;
}

export class PngCodec {
  static encodeRGBA(
    rgba: Uint8Array<ArrayBuffer>,
    width: number,
    height: number,
  ): Uint8Array<ArrayBuffer> {
    this.validateDimensions(rgba.length, width, height);
    const encoded = encode(
      { width, height, data: rgba, depth: 8, channels: 4 },
      { zlib: { level: 3 } },
    );
    return this.transferableView(encoded);
  }

  static decodeRGBA(png: Uint8Array<ArrayBuffer>, width: number, height: number): DecodedPng {
    const decoded = decode(png);
    if (decoded.width !== width || decoded.height !== height) {
      throw new Error(`Expected a ${width}x${height} PNG image, received ${decoded.width}x${decoded.height}.`);
    }
    if (decoded.depth !== 8 || decoded.channels !== 4 || !(decoded.data instanceof Uint8Array)) {
      throw new Error(`Expected an 8-bit RGBA PNG, received depth=${decoded.depth}, channels=${decoded.channels}.`);
    }

    const rgba = this.transferableView(decoded.data);
    this.validateDimensions(rgba.length, width, height);
    return { width, height, rgba };
  }

  private static transferableView(bytes: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
    if (bytes.buffer instanceof ArrayBuffer) {
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    return Uint8Array.from(bytes);
  }

  private static validateDimensions(byteLength: number, width: number, height: number): void {
    const expectedBytes = width * height * 4;
    if (!Number.isSafeInteger(expectedBytes) || width <= 0 || height <= 0 || byteLength !== expectedBytes) {
      throw new Error(`Expected ${expectedBytes} RGBA bytes, received ${byteLength}.`);
    }
  }
}
