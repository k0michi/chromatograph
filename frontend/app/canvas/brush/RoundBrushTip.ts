import MathHelper from "~/math/MathHelper";
import type { BrushMask, BrushTip } from "./BrushTip";

/** Cubic smoothstep */
function smoothstep(t: number): number {
  const x = MathHelper.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export class RoundBrushTip implements BrushTip {
  renderMask(size: number, hardness: number): BrushMask {
    const diameter = Math.max(1, Math.round(size));
    const alpha = new Uint8ClampedArray(diameter * diameter);

    const radius = diameter / 2;
    const innerRadius = radius * MathHelper.clamp(hardness, 0, 1);
    const falloff = Math.max(radius - innerRadius, 0.5);

    for (let y = 0; y < diameter; y++) {
      const dy = y + 0.5 - radius;
      for (let x = 0; x < diameter; x++) {
        const dx = x + 0.5 - radius;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const coverage = 1 - smoothstep((distance - innerRadius) / falloff);
        alpha[y * diameter + x] = Math.round(coverage * 255);
      }
    }

    return { width: diameter, height: diameter, alpha };
  }
}
