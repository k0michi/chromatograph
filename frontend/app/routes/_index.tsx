import { useEffect, useRef, useState } from "react";
import { Brush } from "~/canvas/brush/Brush";
import { BrushStroke } from "~/canvas/brush/BrushStroke";
import { RoundBrushTip } from "~/canvas/brush/RoundBrushTip";
import { CanvasRenderer } from "~/canvas/CanvasRenderer";
import { CanvasScaleBar, type CanvasScaleBarHandle } from "~/canvas/CanvasScaleBar";
import { CursorInspectorPanel, type CursorInspection } from "~/canvas/CursorInspectorPanel";
import { Client } from "~/network/Client";
import { FrameProfilerPanel, type FrameProfilerPanelHandle } from "~/profiling/FrameProfilerPanel";
import type { Route } from "./+types/_index";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Chromatograph" }];
}

export default function Index() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const brushRef = useRef<Brush | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const profilerRef = useRef<FrameProfilerPanelHandle>(null);
  const scaleBarRef = useRef<CanvasScaleBarHandle>(null);
  const cursorScreenRef = useRef<{ x: number; y: number } | null>(null);
  const cursorNeedsInspectionRef = useRef(false);

  const [color, setColor] = useState("#222222");
  const [size, setSize] = useState(40);
  const [hardness, setHardness] = useState(0.8);
  const [opacity, setOpacity] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const [cursorInspection, setCursorInspection] = useState<CursorInspection | null>(null);

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
    if (rendererRef.current) rendererRef.current.showGrid = showGrid;
  }, [showGrid]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const client = new Client(window.location.href, {
      onError: (error) => console.error("Patch WebSocket error:", error),
    });
    const renderer = new CanvasRenderer(canvas, client);
    rendererRef.current = renderer;
    renderer.render();
    void client.connect().catch((error: unknown) => {
      console.error("Failed to connect Patch WebSocket:", error);
    });
    let cursorInspectionPending = false;
    const unsubscribeCanvasContentRendered = renderer.onCanvasContentRendered(() => {
      if (!cursorNeedsInspectionRef.current || cursorInspectionPending) return;
      const screen = cursorScreenRef.current;
      if (screen) {
        const world = renderer.camera.screenToWorld(screen.x, screen.y);
        cursorNeedsInspectionRef.current = false;
        cursorInspectionPending = true;
        void renderer.readSnapshotRgba(world.x, world.y).then((rgba) => {
          setCursorInspection({
            screenX: screen.x,
            screenY: screen.y,
            worldX: world.x,
            worldY: world.y,
            rgba,
          });
        }).catch((error: unknown) => {
          console.error("Failed to inspect snapshot pixel:", error);
        }).finally(() => {
          cursorInspectionPending = false;
        });
      } else {
        setCursorInspection(null);
        cursorNeedsInspectionRef.current = false;
      }
    });
    const unsubscribeSnapshots = client.subscribeSnapshots((snapshots) => {
      void renderer.applySnapshots(snapshots).catch((error: unknown) => {
        console.error("Failed to apply broadcast snapshots:", error);
      });
    });
    const unsubscribePatches = client.subscribePatches((patch) => {
      try {
        renderer.applyPatch(patch);
      } catch (error) {
        console.error("Failed to apply broadcast Patch:", error);
      }
    });

    const brush = new Brush({
      tip: new RoundBrushTip(),
      size,
      hardness,
      color,
      opacity,
      spacing: 0.15,
    });
    brushRef.current = brush;
    let stroke: BrushStroke | null = null;

    let animationFrame = requestAnimationFrame(function loop(timestamp) {
      const renderStart = performance.now();
      renderer.render();
      scaleBarRef.current?.update(renderer.camera.zoom);
      profilerRef.current?.sample(timestamp, performance.now() - renderStart);
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
          void renderer.redo();
        } else {
          void renderer.undo();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        void renderer.redo();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        isSpaceHeld = false;
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      if (isSpaceHeld) {
        panOrigin = { x: event.clientX, y: event.clientY };
        return;
      }
      isPainting = true;
      const world = worldFromEvent(event);
      stroke = new BrushStroke(renderer, brush);
      stroke.begin(world.x, world.y);
    };
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      cursorScreenRef.current = { x: screenX, y: screenY };
      cursorNeedsInspectionRef.current = true;
      if (panOrigin) {
        const dx = event.clientX - panOrigin.x;
        const dy = event.clientY - panOrigin.y;
        panOrigin = { x: event.clientX, y: event.clientY };
        renderer.camera.pan(dx, dy);
        return;
      }
      if (isPainting) {
        const world = worldFromEvent(event);
        stroke?.moveTo(world.x, world.y);
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      panOrigin = null;
      isPainting = false;
      const completedStroke = stroke;
      stroke = null;
      completedStroke?.end().catch((error: unknown) => {
        console.error("Failed to commit stroke:", error);
      });
      canvas.releasePointerCapture(event.pointerId);
    };
    const onPointerLeave = () => {
      cursorScreenRef.current = null;
      cursorNeedsInspectionRef.current = true;
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
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      brushRef.current = null;
      rendererRef.current = null;
      brush.dispose();
      renderer.dispose();
      unsubscribePatches();
      unsubscribeSnapshots();
      unsubscribeCanvasContentRendered();
      client.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          touchAction: "none",
        }}
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
          <button type="button" onClick={() => void rendererRef.current?.undo()}>
            Undo
          </button>
          <button type="button" onClick={() => void rendererRef.current?.redo()}>
            Redo
          </button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(event) => setShowGrid(event.target.checked)}
          />
          Grid
        </label>
        <span style={{ opacity: 0.7 }}>Drag to paint · Space+drag to pan · wheel to zoom · Ctrl/Cmd+Z to undo</span>
      </div>
      <FrameProfilerPanel ref={profilerRef} />
      <div
        style={{
          position: "fixed",
          right: 12,
          bottom: 12,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 12,
          pointerEvents: "none",
        }}
      >
        <CanvasScaleBar ref={scaleBarRef} />
        <CursorInspectorPanel inspection={cursorInspection} />
      </div>
    </>
  );
}
