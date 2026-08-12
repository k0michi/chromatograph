import { describe, expect, it } from "vitest";
import { PngCodec } from "../app/canvas/PngCodec";

describe("PngCodec", () => {
  it("round-trips straight RGBA including RGB beneath transparent pixels", () => {
    const rgba = new Uint8Array([
      255, 0, 0, 0,
      0, 255, 0, 1,
      0, 0, 255, 127,
      12, 34, 56, 255,
    ]);

    const png = PngCodec.encodeRGBA(rgba, 2, 2);
    const decoded = PngCodec.decodeRGBA(png, 2, 2);

    expect(decoded.rgba).toEqual(rgba);
  });
});
