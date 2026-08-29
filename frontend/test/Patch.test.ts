import { describe, expect, it } from "vitest";
import { Identity } from "../app/crypto/Identity";
import { Hex } from "../app/crypto/hex";
import { BlendMode, CompositeOp, ROOT_PATCH_HASH, type PendingBlendOperation } from "../app/canvas/Operation";
import { PATCH_FORMAT_VERSION, Patch } from "../app/canvas/Patch";
import { PatchPayloadEncoder } from "../app/canvas/serializeOperations";

function operation(imageBytes: number[], parent = ROOT_PATCH_HASH): PendingBlendOperation {
  return {
    type: "blend",
    chunk: { x: 12, y: -5 },
    parent,
    compositeOp: CompositeOp.SourceOver,
    blendMode: BlendMode.Normal,
    opacity: 255,
    imageBytes: new Uint8Array(imageBytes),
  };
}

describe("Patch", () => {
  it("binds image bytes and parent hashes into the signed digest", async () => {
    const identity = await Identity.generate();
    const first = await Patch.create([operation([0, 1, 2, 3])], identity);
    const changedPixels = await Patch.create([operation([0, 1, 2, 4])], identity);
    const parent = "ab".repeat(32);
    const changedParents = await Patch.create([operation([0, 1, 2, 3], parent)], identity);

    expect(changedPixels.hash).not.toBe(first.hash);
    expect(changedParents.hash).not.toBe(first.hash);
    const payload = PatchPayloadEncoder.encode({ version: PATCH_FORMAT_VERSION, ...first });
    await expect(Identity.verify(first.publicKeyHex, payload, Hex.toBytes(first.signatureHex))).resolves.toBe(true);
  });
});
