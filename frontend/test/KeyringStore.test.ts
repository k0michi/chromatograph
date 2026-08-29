import { describe, expect, it } from "vitest";
import { KeyringStore } from "../app/crypto/KeyringStore";

describe("KeyringStore", () => {
  it("does not delete the last signing key", async () => {
    const keyring = new KeyringStore();
    await keyring.initialize();
    const onlyKey = keyring.keys[0]!;

    await expect(keyring.deleteKey(onlyKey.id)).rejects.toThrow(
      "The last signing key cannot be deleted.",
    );
    expect(keyring.keys).toHaveLength(1);
    expect(keyring.activeKeyId).toBe(onlyKey.id);
  });
});
