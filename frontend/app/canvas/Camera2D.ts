import { mat3 } from "gl-matrix";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

/** A 2D camera in world space (x right, y down) with optional roll. */
export class Camera2D {
  x: number;
  y: number;
  zoom: number;
  /** Clockwise roll in radians, applied around the viewport centre. */
  rotation = 0;
  /** Mirror the view left-to-right about the viewport centre. */
  flipX = false;
  /** Mirror the view top-to-bottom about the viewport centre. */
  flipY = false;
  private viewportWidth = 1;
  private viewportHeight = 1;

  constructor(
    x = 0,
    y = 0,
    zoom = 1,
    private readonly onChange: () => void = () => {},
  ) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
  }

  resize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  pan(screenDx: number, screenDy: number): void {
    if (screenDx === 0 && screenDy === 0) return;
    // Move the camera along its rotated (and possibly mirrored) screen axes so
    // dragging tracks the pointer.
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    const dx = (this.flipX ? -1 : 1) * screenDx;
    const dy = (this.flipY ? -1 : 1) * screenDy;
    this.x -= (cos * dx + sin * dy) / this.zoom;
    this.y -= (-sin * dx + cos * dy) / this.zoom;
    this.onChange();
  }

  /** Toggle the left-to-right mirror, keeping the viewport centre fixed. */
  toggleFlipX(): void {
    this.flipX = !this.flipX;
    this.onChange();
  }

  /** Toggle the top-to-bottom mirror, keeping the viewport centre fixed. */
  toggleFlipY(): void {
    this.flipY = !this.flipY;
    this.onChange();
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    const before = this.screenToWorld(screenX, screenY);
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    const after = this.screenToWorld(screenX, screenY);
    this.x -= after.x - before.x;
    this.y -= after.y - before.y;
    this.onChange();
  }

  /** Rotate by `deltaRadians`, keeping the given screen point anchored. */
  rotateAt(screenX: number, screenY: number, deltaRadians: number): void {
    if (deltaRadians === 0) return;
    const before = this.screenToWorld(screenX, screenY);
    this.rotation = normalizeAngle(this.rotation + deltaRadians);
    const after = this.screenToWorld(screenX, screenY);
    this.x -= after.x - before.x;
    this.y -= after.y - before.y;
    this.onChange();
  }

  /** Rotate by `deltaRadians`, pivoting about the given screen point (centre by default). */
  rotateBy(
    deltaRadians: number,
    screenX = this.viewportWidth / 2,
    screenY = this.viewportHeight / 2,
  ): void {
    this.rotateAt(screenX, screenY, deltaRadians);
  }

  /** Reset roll to zero, keeping the given screen point anchored. */
  resetRotation(screenX = this.viewportWidth / 2, screenY = this.viewportHeight / 2): void {
    this.rotateAt(screenX, screenY, -this.rotation);
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const offsetX =
      ((screenX - this.viewportWidth / 2) / this.zoom) * (this.flipX ? -1 : 1);
    const offsetY =
      ((screenY - this.viewportHeight / 2) / this.zoom) * (this.flipY ? -1 : 1);
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    return {
      x: this.x + cos * offsetX + sin * offsetY,
      y: this.y - sin * offsetX + cos * offsetY,
    };
  }

  /** The four world-space corners of the viewport, clockwise from top-left. */
  visibleWorldCorners(): { x: number; y: number }[] {
    return [
      this.screenToWorld(0, 0),
      this.screenToWorld(this.viewportWidth, 0),
      this.screenToWorld(this.viewportWidth, this.viewportHeight),
      this.screenToWorld(0, this.viewportHeight),
    ];
  }

  /** Axis-aligned world bounds enclosing the (possibly rotated) viewport. */
  visibleWorldBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    const corners = this.visibleWorldCorners();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const { x, y } of corners) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return { minX, minY, maxX, maxY };
  }

  getViewProjectionMatrix(): mat3 {
    const scaleX = (this.flipX ? -1 : 1) * this.zoom / (this.viewportWidth / 2);
    const scaleY = (this.flipY ? -1 : 1) * -this.zoom / (this.viewportHeight / 2);
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    // Rotate (world - camera) in screen pixels, then scale to clip space.
    const m00 = scaleX * cos;
    const m01 = -scaleX * sin;
    const m10 = scaleY * sin;
    const m11 = scaleY * cos;
    const translateX = -(m00 * this.x + m01 * this.y);
    const translateY = -(m10 * this.x + m11 * this.y);
    // column-major: [ m00 m01 tx ; m10 m11 ty ; 0 0 1 ]
    return mat3.fromValues(m00, m10, 0, m01, m11, 0, translateX, translateY, 1);
  }
}

function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = ((angle % twoPi) + twoPi) % twoPi;
  return wrapped > Math.PI ? wrapped - twoPi : wrapped;
}
