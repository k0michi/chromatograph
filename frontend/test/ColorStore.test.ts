import { describe, expect, it } from "vitest";
import { ColorStore, MAX_COLOR_HISTORY } from "../app/color/ColorStore";

describe("ColorStore", () => {
  it("keeps unique recent colors up to the configured limit", async () => {
    const store = new ColorStore();
    for (let index = 0; index < MAX_COLOR_HISTORY + 3; index++) {
      await store.remember(`#${index.toString(16).padStart(6, "0")}`);
    }
    expect(store.history).toHaveLength(MAX_COLOR_HISTORY);
    expect(store.history[0]).toBe(`#${(MAX_COLOR_HISTORY + 2).toString(16).padStart(6, "0")}`);

    const existing = store.history[4]!;
    await store.remember(existing.toUpperCase());
    expect(store.history[0]).toBe(existing);
    expect(new Set(store.history).size).toBe(store.history.length);
  });

  it("adds, replaces, and deletes saved swatches", async () => {
    const store = new ColorStore();
    await store.addSwatch("#112233");
    await store.addSwatch("#445566");
    await store.replaceSwatch(0, "#abcdef");
    expect(store.swatches).toEqual(["#abcdef", "#445566"]);

    await store.deleteSwatch(0);
    expect(store.swatches).toEqual(["#445566"]);
  });
});
