import { describe, expect, it } from "vitest";
import { BlendMode, CompositeOp, ROOT_PATCH_HASH, type RenderableBlendOperation, type UndoOperation } from "../app/canvas/Operation";
import { Tile } from "../app/canvas/Tile";

function blend(parents: readonly string[] = []): RenderableBlendOperation {
  return {
    type: "blend",
    chunk: { x: 0, y: 0 },
    parent: parents[0] ?? ROOT_PATCH_HASH,
    compositeOp: CompositeOp.SourceOver,
    blendMode: BlendMode.Normal,
    opacity: 255,
    payloadHash: "aa".repeat(32),
    imageBytes: new Uint8Array(),
  };
}

function undo(parents: readonly string[]): UndoOperation {
  return { type: "undo", targetPatchHash: parents[0] };
}

describe("Tile Patch DAG resolution", () => {
  it("keeps a causally later blend above its parent even when its hash sorts first", () => {
    const tile = new Tile(0, 0);
    tile.addOperation("zebra", blend());
    tile.addOperation("alpha", blend(["zebra"]));

    expect(tile.resolveActiveBlendEntries().map((entry) => entry.patchHash)).toEqual(["zebra", "alpha"]);
  });

  it("uses hash order only for concurrent blends", () => {
    const tile = new Tile(0, 0);
    tile.addOperation("zebra", blend());
    tile.addOperation("alpha", blend());

    expect(tile.resolveActiveBlendEntries().map((entry) => entry.patchHash)).toEqual(["alpha", "zebra"]);
  });

  it("linearizes nested branches depth-first instead of interleaving them", () => {
    const tile = new Tile(0, 0);
    tile.addOperation("0000", blend());
    tile.addOperation("3333", blend(["0000"]));
    tile.addOperation("7777", blend(["3333"]));
    tile.addOperation("2222", blend(["3333"]));
    tile.addOperation("1111", blend(["0000"]));
    tile.addOperation("5555", blend(["1111"]));

    expect(tile.resolveActiveBlendEntries().map((entry) => entry.patchHash)).toEqual([
      "0000", "1111", "5555", "3333", "2222", "7777",
    ]);
  });

  it("uses the undo chain with the greatest hash as the visibility authority", () => {
    const tile = new Tile(0, 0);
    tile.addOperation("1000", blend());
    tile.addOperation("2222", undo(["1000"]));
    tile.addOperation("7777", undo(["2222"]));
    tile.addOperation("9999", undo(["1000"]));

    expect(tile.resolveActiveBlendEntries()).toEqual([]);
  });

  it("derives activity without storing it on entries", () => {
    const tile = new Tile(0, 0);
    const first = tile.addOperation("10", blend());
    const second = tile.addOperation("20", blend(["10"]));
    tile.addOperation("30", undo(["20"]));

    expect("active" in first).toBe(false);
    expect(tile.resolveActiveBlendEntries().map((entry) => entry.patchHash)).toEqual(["10"]);
    expect(second.op.type).toBe("blend");
  });

  it("derives redo by following an undo parent and toggling the same blend", () => {
    const tile = new Tile(0, 0);
    tile.addOperation("10", blend());
    tile.addOperation("20", blend(["10"]));
    tile.addOperation("30", undo(["20"]));
    tile.addOperation("40", undo(["30"]));

    expect(tile.resolveActiveBlendEntries().map((entry) => entry.patchHash)).toEqual(["10", "20"]);
  });

  it("removes both blends when two successive undos target their own history records", () => {
    const tile = new Tile(0, 0);
    tile.addOperation("10", blend());
    tile.addOperation("20", blend(["10"]));
    tile.addOperation("30", undo(["20"]));
    tile.addOperation("40", undo(["10"]));

    expect(tile.resolveActiveBlendEntries()).toEqual([]);
  });

});
