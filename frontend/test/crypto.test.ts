import { describe, expect, it } from "vitest";
import { Identity } from "../app/crypto/Identity";
import { Hex } from "../app/crypto/hex";
import { Sha256 } from "../app/crypto/sha256";

describe("crypto primitives", () => {
  it("calculates the SHA-256 known vector for abc", async () => {
    const input = new TextEncoder().encode("abc");
    const digest = await Sha256.digest(input);
    expect(Hex.fromBytes(digest)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(Hex.fromBytes(Sha256.digestSync(input))).toBe(Hex.fromBytes(digest));
  });

  it("rejects malformed hexadecimal", () => {
    expect(() => Hex.toBytes("f")).toThrow("Invalid hex string");
    expect(() => Hex.toBytes("gg")).toThrow("Invalid hex string");
  });

  it("verifies with an exported public key and rejects modified data", async () => {
    const identity = await Identity.generate();
    const data = new TextEncoder().encode("signed patch digest");
    const signature = await identity.sign(data);

    await expect(Identity.verify(identity.publicKeyHex, data, signature)).resolves.toBe(true);
    await expect(Identity.verify(identity.publicKeyHex, new TextEncoder().encode("modified"), signature)).resolves.toBe(false);
  });
});
