import { useEffect, useRef } from "react";
import { CanvasRenderer } from "~/canvas/CanvasRenderer";
import { generateDemoTiles } from "~/canvas/generateDemoTiles";
import type { Route } from "./+types/_index";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Chromatograph" }];
}

export default function Index() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const renderer = new CanvasRenderer(canvas);
    generateDemoTiles(renderer);

    let animationFrame = requestAnimationFrame(function loop() {
      renderer.render();
      animationFrame = requestAnimationFrame(loop);
    });

    let dragOrigin: { x: number; y: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      dragOrigin = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragOrigin) {
        return;
      }
      const dx = event.clientX - dragOrigin.x;
      const dy = event.clientY - dragOrigin.y;
      dragOrigin = { x: event.clientX, y: event.clientY };
      renderer.camera.pan(dx, dy);
    };
    const onPointerUp = (event: PointerEvent) => {
      dragOrigin = null;
      canvas.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.001);
      renderer.camera.zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(animationFrame);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100vw", height: "100vh", display: "block", touchAction: "none" }}
    />
  );
}
