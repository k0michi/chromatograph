import { describe, expect, it } from "vitest";
import { worldToChunkPosition } from "../app/canvas/chunkSpace";

describe("worldToChunkPosition", () => {
  it("converts positive world coordinates", () => {
    expect(worldToChunkPosition(300.75, 511.9)).toEqual({
      chunkX: 1,
      chunkY: 1,
      subchunkX: 44,
      subchunkY: 255,
    });
  });

  it("keeps subchunk coordinates positive for negative world coordinates", () => {
    expect(worldToChunkPosition(-0.1, -256.1)).toEqual({
      chunkX: -1,
      chunkY: -2,
      subchunkX: 255,
      subchunkY: 255,
    });
  });

  it("handles exact chunk boundaries", () => {
    expect(worldToChunkPosition(-256, 256)).toEqual({
      chunkX: -1,
      chunkY: 1,
      subchunkX: 0,
      subchunkY: 0,
    });
  });
});
