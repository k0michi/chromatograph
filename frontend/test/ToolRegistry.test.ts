import { describe, expect, it } from "vitest";
import { createDefaultToolSettings, toolForKey, updatePaintToolSettings } from "../app/tools/ToolRegistry";

describe("ToolRegistry", () => {
  it("keeps paint settings independent for each tool", () => {
    const defaults = createDefaultToolSettings();
    const changed = updatePaintToolSettings(defaults, "eraser", { size: 96, opacity: 0.4 });

    expect(changed.eraser.size).toBe(96);
    expect(changed.eraser.opacity).toBe(0.4);
    expect(changed.brush.size).toBe(40);
    expect(changed.brush.opacity).toBe(1);
    expect(defaults.eraser.size).toBe(40);
  });

  it("resolves tool shortcuts from the registry", () => {
    expect(toolForKey("B")).toBe("brush");
    expect(toolForKey("e")).toBe("eraser");
    expect(toolForKey("i")).toBe("eyedropper");
    expect(toolForKey("v")).toBe("move");
    expect(toolForKey("x")).toBeNull();
  });
});
