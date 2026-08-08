import { describe, expect, it } from "vitest";
import { Identity } from "../app/crypto/Identity";
import { Hex } from "../app/crypto/hex";
import { BlendMode, CompositeOp, type BlendOperation } from "../app/canvas/Operation";
import { Patch } from "../app/canvas/Patch";

function operation(imageBytes: number[], parents: readonly string[] = []): BlendOperation {
  return {
    type: "blend",
    chunk: { x: 12, y: -5 },
    parents,
    compositeOp: CompositeOp.SourceOver,
    blendMode: BlendMode.Normal,
    opacity: 1,
    imageBytes: new Uint8Array(imageBytes),
  };
}

describe("Patch", () => {
  it("binds image bytes and parent hashes into the signed digest", async () => {
    const identity = await Identity.generate();
    const first = await Patch.create([operation([0, 1, 2, 3])], identity);
    const changedPixels = await Patch.create([operation([0, 1, 2, 4])], identity);
    const parent = "ab".repeat(32);
    const changedParents = await Patch.create([operation([0, 1, 2, 3], [parent])], identity);

    expect(changedPixels.hash).not.toBe(first.hash);
    expect(changedParents.hash).not.toBe(first.hash);
    await expect(Identity.verify(first.publicKeyHex, Hex.toBytes(first.hash), Hex.toBytes(first.signatureHex))).resolves.toBe(true);
  });
});
