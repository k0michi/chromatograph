import { mat3 } from "gl-matrix";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

/** A 2D camera in world space (x right, y down) */
export class Camera2D {
  x: number;
  y: number;
  zoom: number;
  private viewportWidth = 1;
  private viewportHeight = 1;

  constructor(x = 0, y = 0, zoom = 1) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
  }

  resize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  pan(screenDx: number, screenDy: number): void {
    this.x -= screenDx / this.zoom;
    this.y -= screenDy / this.zoom;
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    const before = this.screenToWorld(screenX, screenY);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    const after = this.screenToWorld(screenX, screenY);
    this.x -= after.x - before.x;
    this.y -= after.y - before.y;
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: this.x + (screenX - this.viewportWidth / 2) / this.zoom,
      y: this.y + (screenY - this.viewportHeight / 2) / this.zoom,
    };
  }

  visibleWorldBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    const halfWidth = this.viewportWidth / 2 / this.zoom;
    const halfHeight = this.viewportHeight / 2 / this.zoom;
    return {
      minX: this.x - halfWidth,
      minY: this.y - halfHeight,
      maxX: this.x + halfWidth,
      maxY: this.y + halfHeight,
    };
  }

  getViewProjectionMatrix(): mat3 {
    const scaleX = this.zoom / (this.viewportWidth / 2);
    const scaleY = -this.zoom / (this.viewportHeight / 2);
    const translateX = -this.x * scaleX;
    const translateY = -this.y * scaleY;
    // [ scaleX,      0, translateX ]
    // [      0, scaleY, translateY ]
    // [      0,      0,          1 ]
    return mat3.fromValues(scaleX, 0, 0, 0, scaleY, 0, translateX, translateY, 1);
  }
}
