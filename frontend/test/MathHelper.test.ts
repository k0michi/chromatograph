import { describe, expect, it } from "vitest";
import MathHelper from "~/math/MathHelper";

describe("MathHelper", () => {
  it("clamps a value to the specified range", () => {
    expect(MathHelper.clamp(-1, 0, 10)).toBe(0);
    expect(MathHelper.clamp(4, 0, 10)).toBe(4);
    expect(MathHelper.clamp(11, 0, 10)).toBe(10);
  });
});
