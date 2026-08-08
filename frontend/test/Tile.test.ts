import { describe, expect, it } from "vitest";
import { BlendMode, CompositeOp, type BlendOperation, type UndoOperation } from "../app/canvas/Operation";
import { Tile } from "../app/canvas/Tile";

function blend(parents: readonly string[] = []): BlendOperation {
  return {
    type: "blend",
    chunk: { x: 0, y: 0 },
    parents,
    compositeOp: CompositeOp.SourceOver,
    blendMode: BlendMode.Normal,
    opacity: 1,
    imageBytes: new Uint8Array(),
  };
}

function undo(parents: readonly string[]): UndoOperation {
  return { type: "undo", chunk: { x: 0, y: 0 }, parents };
}

describe("Tile Patch DAG resolution", () => {
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

  it("allows multiple targets when all represent the same Blend and visibility state", () => {
    const tile = new Tile(0, 0);
    tile.addOperation("10", blend());
    tile.addOperation("20", undo(["10"]));
    tile.addOperation("30", undo(["10"]));
    tile.addOperation("40", undo(["20", "30"]));

    expect(tile.resolveActiveBlendEntries()).toEqual([]);
  });

  it("rejects targets for the same Blend when their visibility states differ", () => {
    const tile = new Tile(0, 0);
    tile.addOperation("10", blend());
    tile.addOperation("20", undo(["10"]));
    tile.addOperation("30", undo(["10", "20"]));

    expect(() => tile.resolveActiveBlendEntries()).toThrow(/same Blend state/);
  });

  it("rejects targets that refer to different Blends", () => {
    const tile = new Tile(0, 0);
    tile.addOperation("10", blend());
    tile.addOperation("20", blend(["10"]));
    tile.addOperation("30", undo(["10", "20"]));

    expect(() => tile.resolveActiveBlendEntries()).toThrow(/same Blend state/);
  });
});
