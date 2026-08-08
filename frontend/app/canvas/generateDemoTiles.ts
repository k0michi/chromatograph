import type { CanvasRenderer } from "./CanvasRenderer";
import { Patch } from "./Patch";
import { TILE_SIZE } from "./Tile";

interface DemoPatchSpec {
  color: string;
  opacity: number;
}

interface DemoTileSpec {
  x: number;
  y: number;
  patches: DemoPatchSpec[];
}

const DEMO_TILES: DemoTileSpec[] = [
  { x: 0, y: 0, patches: [{ color: "#ff5470", opacity: 1 }] },
  { x: 1, y: 0, patches: [{ color: "#00d4ff", opacity: 1 }, { color: "#ffe066", opacity: 0.5 }] },
  { x: 0, y: 1, patches: [{ color: "#5eff9b", opacity: 1 }, { color: "#8a5eff", opacity: 0.6 }] },
  { x: -1, y: 0, patches: [{ color: "#ff9d5e", opacity: 1 }] },
  { x: -1, y: -1, patches: [{ color: "#5ec6ff", opacity: 1 }, { color: "#ff5ec6", opacity: 0.45 }] },
  { x: 2, y: -1, patches: [{ color: "#c6ff5e", opacity: 1 }] },
];

function renderPatchImage(color: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create a 2D canvas context for demo tile generation.");
  }
  const gradient = ctx.createRadialGradient(
    TILE_SIZE / 2, TILE_SIZE / 2, 0,
    TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2,
  );
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "transparent");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  return canvas;
}

export function generateDemoTiles(renderer: CanvasRenderer): void {
  for (const spec of DEMO_TILES) {
    const tile = renderer.tiles.getOrCreate(spec.x, spec.y);
    for (const patchSpec of spec.patches) {
      const image = renderPatchImage(patchSpec.color);
      const texture = renderer.device.createTexture({ source: image });
      const bindGroup = renderer.createPatchBindGroup(texture);
      tile.addPatch(new Patch(texture, bindGroup, patchSpec.opacity));
    }
  }
}
