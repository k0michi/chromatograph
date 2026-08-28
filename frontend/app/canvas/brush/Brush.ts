import type { BindGroup } from "~/webgl/BindGroup";
import type { RawImageSource, Texture } from "~/webgl/Texture";
import type { CanvasRenderer } from "../CanvasRenderer";
import type { CompositeOp } from "../Operation";
import type { BrushMask, BrushTip } from "./BrushTip";

export interface BrushSettings {
  tip: BrushTip;
  compositeOp: CompositeOp;
  size: number;
  hardness: number;
  color: string;
  opacity: number;
  spacing: number;
  /** Screen-space input smoothing strength (0 = raw, 1 = strongest). */
  smoothing: number;
  /** How strongly pen pressure scales the stamp size (0 = off, 1 = full range). */
  pressureSize: number;
  /** How strongly pen pressure scales the stamp opacity (0 = off, 1 = full range). */
  pressureOpacity: number;
}

const HEX_COLOR_PATTERN = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

function parseHexColor(hex: string): readonly [number, number, number] {
  const match = HEX_COLOR_PATTERN.exec(hex);
  if (!match) {
    throw new Error(`Unsupported brush color "${hex}": expected a "#rrggbb" hex string.`);
  }
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

function buildStampImage(mask: BrushMask, color: string): RawImageSource {
  const [r, g, b] = parseHexColor(color);
  const data = new Uint8ClampedArray(mask.width * mask.height * 4);
  for (let i = 0; i < mask.alpha.length; i++) {
    const a = mask.alpha[i];
    data[i * 4 + 0] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width: mask.width, height: mask.height, data };
}

export class Brush {
  private readonly cache = new Map<string, { texture: Texture; bindGroup: BindGroup }>();

  constructor(public settings: BrushSettings) { }

  private cacheKey(): string {
    const { tip, size, hardness, color } = this.settings;
    return `${tip.constructor.name}:${size}:${hardness}:${color}`;
  }

  getStamp(renderer: CanvasRenderer): { texture: Texture; bindGroup: BindGroup } {
    const key = this.cacheKey();
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const mask = this.settings.tip.renderMask(this.settings.size, this.settings.hardness);
    const image = buildStampImage(mask, this.settings.color);
    const texture = renderer.device.createTexture({ source: image });
    const bindGroup = renderer.createPatchBindGroup(texture);
    const stamp = { texture, bindGroup };
    this.cache.set(key, stamp);
    return stamp;
  }

  dispose(): void {
    for (const stamp of this.cache.values()) {
      stamp.texture.dispose();
    }
    this.cache.clear();
  }
}
