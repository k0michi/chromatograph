import { useEffect, useRef, useState } from "react";
import { Brush } from "~/canvas/brush/Brush";
import { BrushStroke } from "~/canvas/brush/BrushStroke";
import { RoundBrushTip } from "~/canvas/brush/RoundBrushTip";
import { CanvasRenderer } from "~/canvas/CanvasRenderer";
import type { Route } from "./+types/_index";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Chromatograph" }];
}

export default function Index() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const brushRef = useRef<Brush | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);

  const [color, setColor] = useState("#222222");
  const [size, setSize] = useState(40);
  const [hardness, setHardness] = useState(0.8);
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    const brush = brushRef.current;
    if (!brush) {
      return;
    }
    brush.settings.color = color;
    brush.settings.size = size;
    brush.settings.hardness = hardness;
    brush.settings.opacity = opacity;
  }, [color, size, hardness, opacity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const renderer = new CanvasRenderer(canvas);
    rendererRef.current = renderer;

    const brush = new Brush({
      tip: new RoundBrushTip(),
      size,
      hardness,
      color,
      opacity,
      spacing: 0.15,
    });
    brushRef.current = brush;
    const stroke = new BrushStroke(renderer, brush);

    let animationFrame = requestAnimationFrame(function loop() {
      renderer.render();
      animationFrame = requestAnimationFrame(loop);
    });

    let panOrigin: { x: number; y: number } | null = null;
    let isPainting = false;
    let isSpaceHeld = false;

    const worldFromEvent = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return renderer.camera.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        isSpaceHeld = true;
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          renderer.redo();
        } else {
          renderer.undo();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        renderer.redo();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        isSpaceHeld = false;
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      if (isSpaceHeld) {
        panOrigin = { x: event.clientX, y: event.clientY };
        return;
      }
      isPainting = true;
      const world = worldFromEvent(event);
      stroke.begin(world.x, world.y);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (panOrigin) {
        const dx = event.clientX - panOrigin.x;
        const dy = event.clientY - panOrigin.y;
        panOrigin = { x: event.clientX, y: event.clientY };
        renderer.camera.pan(dx, dy);
        return;
      }
      if (isPainting) {
        const world = worldFromEvent(event);
        stroke.moveTo(world.x, world.y);
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      panOrigin = null;
      isPainting = false;
      stroke.end();
      canvas.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.001);
      renderer.camera.zoomAt(event.clientX - rect.left, event.clientY - rect.top, factor);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      brushRef.current = null;
      rendererRef.current = null;
      brush.dispose();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ width: "100vw", height: "100vh", display: "block", touchAction: "none" }}
      />
      <div
        style={{
          position: "fixed",
          top: 16,
          left: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 12,
          borderRadius: 8,
          background: "rgba(20, 20, 24, 0.8)",
          color: "white",
          fontFamily: "sans-serif",
          fontSize: 12,
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Color
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Size ({size})
          <input
            type="range"
            min={2}
            max={200}
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Hardness ({hardness.toFixed(2)})
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={hardness}
            onChange={(event) => setHardness(Number(event.target.value))}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Opacity ({opacity.toFixed(2)})
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
          />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => rendererRef.current?.undo()}>
            Undo
          </button>
          <button type="button" onClick={() => rendererRef.current?.redo()}>
            Redo
          </button>
        </div>
        <span style={{ opacity: 0.7 }}>Drag to paint · Space+drag to pan · wheel to zoom · Ctrl/Cmd+Z to undo</span>
      </div>
    </>
  );
}
