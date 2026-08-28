import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Brush } from "~/canvas/brush/Brush";
import { BrushStroke } from "~/canvas/brush/BrushStroke";
import { RoundBrushTip } from "~/canvas/brush/RoundBrushTip";
import { CanvasRenderer } from "~/canvas/CanvasRenderer";
import { CanvasScaleBar, type CanvasScaleBarHandle } from "~/canvas/CanvasScaleBar";
import { CursorInspectorPanel, type CursorInspection } from "~/canvas/CursorInspectorPanel";
import { CompositeOp } from "~/canvas/Operation";
import { Client } from "~/network/Client";
import { NetworkDebugPanel, type NetworkDebugPanelHandle } from "~/network/NetworkDebugPanel";
import { FrameProfilerPanel, type FrameProfilerPanelHandle } from "~/profiling/FrameProfilerPanel";
import { PanelWindow } from "~/ui/PanelWindow";
import type { Route } from "./+types/_index";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Chromatograph" }];
}

const topBarStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  height: 44,
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "0 14px",
  background: "var(--panel-bg)",
  borderBottom: "1px solid var(--panel-border)",
  color: "var(--text)",
  fontFamily: "sans-serif",
  fontSize: 12,
  zIndex: 20,
  overflowX: "auto",
  whiteSpace: "nowrap",
};

const topBarDividerStyle: React.CSSProperties = {
  width: 1,
  height: 24,
  background: "var(--panel-border-strong)",
  flexShrink: 0,
};

const fieldStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 };
const rangeStyle: React.CSSProperties = { width: 96 };
const fieldLabelStyle: React.CSSProperties = { color: "var(--text-muted)" };
const fieldValueStyle: React.CSSProperties = {
  minWidth: 30,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const topBtnStyle: React.CSSProperties = {
  background: "var(--control-bg)",
  color: "var(--text)",
  border: "1px solid var(--panel-border-strong)",
  borderRadius: 5,
  padding: "4px 10px",
  cursor: "pointer",
  fontSize: 12,
  flexShrink: 0,
};

const toolRailStyle: React.CSSProperties = {
  position: "fixed",
  top: 44,
  left: 0,
  bottom: 0,
  width: 52,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  padding: "10px 0",
  background: "var(--panel-bg)",
  borderRight: "1px solid var(--panel-border)",
  zIndex: 20,
};

const toolRailDividerStyle: React.CSSProperties = {
  width: 28,
  height: 1,
  background: "var(--panel-border-strong)",
  margin: "2px 0",
};

const sidebarStyle: React.CSSProperties = {
  position: "fixed",
  top: 44,
  right: 0,
  bottom: 0,
  width: 300,
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 8,
  background: "var(--panel-bg)",
  borderLeft: "1px solid var(--panel-border)",
  overflowY: "auto",
  zIndex: 20,
};

function toolButtonStyle(active: boolean): React.CSSProperties {
  return {
    width: 36,
    height: 36,
    borderRadius: 6,
    border: active ? "1px solid var(--accent)" : "1px solid var(--panel-border-strong)",
    background: active ? "var(--accent-bg)" : "var(--control-bg)",
    color: "var(--text)",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  };
}

export default function Index() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const brushRef = useRef<Brush | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const profilerRef = useRef<FrameProfilerPanelHandle>(null);
  const scaleBarRef = useRef<CanvasScaleBarHandle>(null);
  const networkDebugRef = useRef<NetworkDebugPanelHandle>(null);
  const cursorScreenRef = useRef<{ x: number; y: number } | null>(null);
  const cursorNeedsInspectionRef = useRef(false);

  const [color, setColor] = useState("#222222");
  const [compositeOp, setCompositeOp] = useState(CompositeOp.SourceOver);
  const [size, setSize] = useState(40);
  const [hardness, setHardness] = useState(0.8);
  const [opacity, setOpacity] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const [cursorInspection, setCursorInspection] = useState<CursorInspection | null>(null);

  const isEraser = compositeOp === CompositeOp.DestinationOut;

  useEffect(() => {
    const brush = brushRef.current;
    if (!brush) {
      return;
    }
    brush.settings.color = color;
    brush.settings.size = size;
    brush.settings.hardness = hardness;
    brush.settings.opacity = opacity;
    brush.settings.compositeOp = compositeOp;
  }, [color, size, hardness, opacity, compositeOp]);

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
    const unsubscribePacketLogs = client.subscribePacketLogs((entry) => {
      networkDebugRef.current?.append(entry);
    });
    const unsubscribeConnectionState = client.subscribeConnectionState((state) => {
      networkDebugRef.current?.setConnectionState(state);
    });
    const renderer = new CanvasRenderer(canvas, client);
    rendererRef.current = renderer;
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
      compositeOp,
      size,
      hardness,
      color,
      opacity,
      spacing: 0.15,
    });
    brushRef.current = brush;
    let stroke: BrushStroke | null = null;

    let animationFrame: number | null = null;
    const renderFrame = (timestamp: number) => {
      animationFrame = null;
      const renderStart = performance.now();
      renderer.render();
      scaleBarRef.current?.update(renderer.camera.zoom);
      profilerRef.current?.sample(timestamp, performance.now() - renderStart);
    };
    const scheduleRender = () => {
      if (animationFrame !== null) return;
      animationFrame = requestAnimationFrame(renderFrame);
    };
    const unsubscribeInvalidated = renderer.onInvalidated(scheduleRender);
    const resizeObserver = new ResizeObserver(scheduleRender);
    resizeObserver.observe(canvas);
    scheduleRender();

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
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "b") {
        setCompositeOp(CompositeOp.SourceOver);
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "e") {
        setCompositeOp(CompositeOp.DestinationOut);
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
      renderer.invalidate();
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
      renderer.invalidate();
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
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
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
      unsubscribePacketLogs();
      unsubscribeConnectionState();
      unsubscribeInvalidated();
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
      {/* Top options bar (contextual to the active tool) */}
      <div style={topBarStyle}>
        <span style={{ fontWeight: 700, opacity: 0.85, minWidth: 56 }}>
          {isEraser ? "Eraser" : "Brush"}
        </span>
        <div style={topBarDividerStyle} />
        <label style={fieldStyle}>
          <span style={fieldLabelStyle}>Size</span>
          <input
            type="range"
            style={rangeStyle}
            min={2}
            max={200}
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
          />
          <span style={fieldValueStyle}>{size}</span>
        </label>
        <label style={fieldStyle}>
          <span style={fieldLabelStyle}>Hardness</span>
          <input
            type="range"
            style={rangeStyle}
            min={0}
            max={1}
            step={0.01}
            value={hardness}
            onChange={(event) => setHardness(Number(event.target.value))}
          />
          <span style={fieldValueStyle}>{hardness.toFixed(2)}</span>
        </label>
        <label style={fieldStyle}>
          <span style={fieldLabelStyle}>Opacity</span>
          <input
            type="range"
            style={rangeStyle}
            min={0}
            max={1}
            step={0.01}
            value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
          />
          <span style={fieldValueStyle}>{opacity.toFixed(2)}</span>
        </label>
        <div style={topBarDividerStyle} />
        <button type="button" style={topBtnStyle} onClick={() => void rendererRef.current?.undo()}>
          Undo
        </button>
        <button type="button" style={topBtnStyle} onClick={() => void rendererRef.current?.redo()}>
          Redo
        </button>
        <div style={topBarDividerStyle} />
        <label style={{ ...fieldStyle, gap: 6 }}>
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(event) => setShowGrid(event.target.checked)}
          />
          <span style={fieldLabelStyle}>Grid</span>
        </label>
      </div>

      {/* Left tool rail */}
      <div style={toolRailStyle}>
        <button
          type="button"
          title="Brush (B)"
          aria-pressed={!isEraser}
          style={toolButtonStyle(!isEraser)}
          onClick={() => setCompositeOp(CompositeOp.SourceOver)}
        >
          B
        </button>
        <button
          type="button"
          title="Eraser (E)"
          aria-pressed={isEraser}
          style={toolButtonStyle(isEraser)}
          onClick={() => setCompositeOp(CompositeOp.DestinationOut)}
        >
          E
        </button>
        <div style={toolRailDividerStyle} />
        <label
          title="Color"
          style={{
            position: "relative",
            width: 36,
            height: 36,
            borderRadius: 6,
            border: "2px solid rgba(255, 255, 255, 0.35)",
            background: color,
            cursor: "pointer",
          }}
        >
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
          />
        </label>
      </div>
      {/* Right sidebar (docked panels; will become movable windows later) */}
      <aside style={sidebarStyle}>
        <PanelWindow title="Inspector">
          <CursorInspectorPanel inspection={cursorInspection} />
        </PanelWindow>
        <PanelWindow title="Performance">
          <FrameProfilerPanel ref={profilerRef} />
        </PanelWindow>
        <PanelWindow title="Network" defaultCollapsed>
          <NetworkDebugPanel ref={networkDebugRef} />
        </PanelWindow>
      </aside>

      {/* Scale bar HUD over the canvas */}
      <div
        style={{
          position: "fixed",
          left: 64,
          bottom: 12,
          display: "flex",
          pointerEvents: "none",
        }}
      >
        <CanvasScaleBar ref={scaleBarRef} />
      </div>
    </>
  );
}
