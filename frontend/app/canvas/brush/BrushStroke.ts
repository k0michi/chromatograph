import type { CanvasRenderer } from "../CanvasRenderer";
import { Patch } from "../Patch";
import { TILE_SIZE } from "../Tile";
import type { Brush } from "./Brush";

export class BrushStroke {
  private lastStampPoint: { x: number; y: number } | null = null;

  constructor(
    private readonly renderer: CanvasRenderer,
    private readonly brush: Brush,
  ) { }

  begin(worldX: number, worldY: number): void {
    this.lastStampPoint = { x: worldX, y: worldY };
    this.stampAt(worldX, worldY);
  }

  moveTo(worldX: number, worldY: number): void {
    if (!this.lastStampPoint) {
      this.begin(worldX, worldY);
      return;
    }

    const spacing = Math.max(1, this.brush.settings.size * this.brush.settings.spacing);
    let lastX = this.lastStampPoint.x;
    let lastY = this.lastStampPoint.y;
    let distance = Math.hypot(worldX - lastX, worldY - lastY);

    while (distance >= spacing) {
      const t = spacing / distance;
      const stampX = lastX + (worldX - lastX) * t;
      const stampY = lastY + (worldY - lastY) * t;
      this.stampAt(stampX, stampY);
      lastX = stampX;
      lastY = stampY;
      distance = Math.hypot(worldX - lastX, worldY - lastY);
    }

    this.lastStampPoint = { x: lastX, y: lastY };
  }

  end(): void {
    this.lastStampPoint = null;
  }

  private stampAt(worldX: number, worldY: number): void {
    const { texture, bindGroup } = this.brush.getStamp(this.renderer);
    const { size, opacity } = this.brush.settings;
    const patch = new Patch(texture, bindGroup, opacity, worldX - size / 2, worldY - size / 2, size);

    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    this.renderer.tiles.getOrCreate(tileX, tileY).addPatch(patch);
  }
}
