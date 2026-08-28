import { describe, expect, it } from "vitest";
import { Camera2D } from "~/canvas/Camera2D";

describe("Camera2D", () => {
  it("round-trips screen <-> world with rotation", () => {
    const camera = new Camera2D(30, -40, 2);
    camera.resize(800, 600);
    camera.rotation = Math.PI / 5;

    const world = camera.screenToWorld(123, 456);
    // Re-derive the screen point from the view-projection matrix.
    const m = camera.getViewProjectionMatrix();
    const clipX = m[0] * world.x + m[3] * world.y + m[6];
    const clipY = m[1] * world.x + m[4] * world.y + m[7];
    const screenX = (clipX + 1) * 0.5 * 800;
    const screenY = (1 - clipY) * 0.5 * 600;

    expect(screenX).toBeCloseTo(123, 4);
    expect(screenY).toBeCloseTo(456, 4);
    expect(camera.worldToScreen(world.x, world.y)).toEqual({
      x: expect.closeTo(123, 4),
      y: expect.closeTo(456, 4),
    });
  });

  it("keeps the anchor point fixed while rotating", () => {
    const camera = new Camera2D(0, 0, 1.5);
    camera.resize(1000, 800);
    const anchorBefore = camera.screenToWorld(700, 200);

    camera.rotateAt(700, 200, Math.PI / 3);

    const anchorAfter = camera.screenToWorld(700, 200);
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 6);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 6);
  });

  it("round-trips screen <-> world with flip and rotation combined", () => {
    const camera = new Camera2D(12, 8, 1.3);
    camera.resize(900, 500);
    camera.rotation = -0.7;
    camera.toggleFlipX();
    camera.toggleFlipY();

    const world = camera.screenToWorld(640, 210);
    const m = camera.getViewProjectionMatrix();
    const clipX = m[0] * world.x + m[3] * world.y + m[6];
    const clipY = m[1] * world.x + m[4] * world.y + m[7];
    expect((clipX + 1) * 0.5 * 900).toBeCloseTo(640, 4);
    expect((1 - clipY) * 0.5 * 500).toBeCloseTo(210, 4);
    expect(camera.worldToScreen(world.x, world.y).x).toBeCloseTo(640, 4);
    expect(camera.worldToScreen(world.x, world.y).y).toBeCloseTo(210, 4);
  });

  it("mirrors the x axis when flipX is toggled", () => {
    const camera = new Camera2D(0, 0, 1);
    camera.resize(400, 400);
    const right = camera.screenToWorld(300, 200).x;
    camera.toggleFlipX();
    const mirrored = camera.screenToWorld(300, 200).x;
    expect(mirrored).toBeCloseTo(-right, 6);
  });

  it("resetRotation returns roll to zero", () => {
    const camera = new Camera2D(10, 10, 1);
    camera.resize(640, 480);
    camera.rotateAt(320, 240, 1.2);
    camera.resetRotation();
    expect(camera.rotation).toBeCloseTo(0, 10);
  });
});
