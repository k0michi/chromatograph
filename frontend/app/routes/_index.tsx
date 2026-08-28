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
import { MenuBar, type MenuBarMenu } from "~/ui/MenuBar";
import { PanelWindow } from "~/ui/PanelWindow";
import type { Route } from "./+types/_index";

const MENU_BAR_HEIGHT = 28;
const OPTIONS_BAR_HEIGHT = 44;
const CHROME_TOP = MENU_BAR_HEIGHT + OPTIONS_BAR_HEIGHT;

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Chromatograph" }];
}

type Tool = "brush" | "eraser" | "move" | "zoom" | "rotate";

const TOOL_LABELS: Record<Tool, string> = {
  brush: "Brush",
  eraser: "Eraser",
  move: "Move",
  zoom: "Zoom",
  rotate: "Rotate",
};

function cursorForTool(tool: Tool): string {
  if (tool === "move") return "grab";
  if (tool === "zoom") return "zoom-in";
  if (tool === "rotate") return "grab";
  return "crosshair";
}

const TOOL_RAIL: readonly { id: Tool; glyph: string; shortcut: string }[] = [
  { id: "brush", glyph: "B", shortcut: "B" },
  { id: "eraser", glyph: "E", shortcut: "E" },
  { id: "move", glyph: "M", shortcut: "H" },
  { id: "zoom", glyph: "Z", shortcut: "Z" },
  { id: "rotate", glyph: "R", shortcut: "R" },
];

const menuBarStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  height: MENU_BAR_HEIGHT,
  display: "flex",
  alignItems: "stretch",
  padding: "0 6px",
  background: "var(--panel-bg)",
  borderBottom: "1px solid var(--panel-border)",
  color: "var(--text)",
  fontFamily: "sans-serif",
  zIndex: 21,
};

const topBarStyle: React.CSSProperties = {
  position: "fixed",
  top: MENU_BAR_HEIGHT,
  left: 0,
  right: 0,
  height: OPTIONS_BAR_HEIGHT,
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
  top: CHROME_TOP,
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
  top: CHROME_TOP,
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
  const [tool, setTool] = useState<Tool>("brush");
  const [size, setSize] = useState(40);
  const [hardness, setHardness] = useState(0.8);
  const [opacity, setOpacity] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const [cursorInspection, setCursorInspection] = useState<CursorInspection | null>(null);

  const isEraser = tool === "eraser";
  const isPaintTool = tool === "brush" || tool === "eraser";
  const compositeOp = isEraser ? CompositeOp.DestinationOut : CompositeOp.SourceOver;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const isSpaceHeldRef = useRef(false);

  const menus: MenuBarMenu[] = [
    {
      label: "Edit",
      items: [
        {
          label: "Undo",
          shortcut: "⌘Z",
          disabled: () => !rendererRef.current?.canUndo,
          onSelect: () => void rendererRef.current?.undo(),
        },
        {
          label: "Redo",
          shortcut: "⇧⌘Z",
          disabled: () => !rendererRef.current?.canRedo,
          onSelect: () => void rendererRef.current?.redo(),
        },
      ],
    },
    {
      label: "View",
      items: [
        {
          label: "Show Grid",
          checked: showGrid,
          onSelect: () => setShowGrid((value) => !value),
        },
        { separator: true, label: "" },
        {
          label: "Flip Horizontal",
          checked: () => Boolean(rendererRef.current?.camera.flipX),
          onSelect: () => rendererRef.current?.camera.toggleFlipX(),
        },
        {
          label: "Flip Vertical",
          checked: () => Boolean(rendererRef.current?.camera.flipY),
          onSelect: () => rendererRef.current?.camera.toggleFlipY(),
        },
        { separator: true, label: "" },
        {
          label: "Reset Rotation",
          onSelect: () => rendererRef.current?.camera.resetRotation(),
        },
      ],
    },
  ];

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
    if (!canvas) return;
    if (isSpaceHeldRef.current) return;
    canvas.style.cursor = cursorForTool(tool);
  }, [tool]);

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

    const SCRUB_DRAG_THRESHOLD = 4;
    let panOrigin: { x: number; y: number } | null = null;
    let scrubDrag:
      | {
          kind: "zoom" | "rotate";
          anchorX: number;
          anchorY: number;
          startX: number;
          lastX: number;
          alt: boolean;
          dragging: boolean;
        }
      | null = null;
    let isPainting = false;

    const restoreCursor = () => {
      canvas.style.cursor = isSpaceHeldRef.current ? "grab" : cursorForTool(toolRef.current);
    };

    const worldFromEvent = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return renderer.camera.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        if (!isSpaceHeldRef.current) {
          isSpaceHeldRef.current = true;
          canvas.style.cursor = panOrigin ? "grabbing" : "grab";
        }
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "b") return setTool("brush");
        if (key === "e") return setTool("eraser");
        if (key === "h" || key === "v") return setTool("move");
        if (key === "z") return setTool("zoom");
        if (key === "r") return setTool("rotate");
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
        isSpaceHeldRef.current = false;
        if (!panOrigin) restoreCursor();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      const activeTool = toolRef.current;
      if (isSpaceHeldRef.current || activeTool === "move") {
        panOrigin = { x: event.clientX, y: event.clientY };
        canvas.style.cursor = "grabbing";
        return;
      }
      if (activeTool === "zoom" || activeTool === "rotate") {
        const rect = canvas.getBoundingClientRect();
        // Rotation always pivots about the viewport centre; zoom about the pointer.
        scrubDrag = {
          kind: activeTool,
          anchorX: activeTool === "rotate" ? rect.width / 2 : event.clientX - rect.left,
          anchorY: activeTool === "rotate" ? rect.height / 2 : event.clientY - rect.top,
          startX: event.clientX,
          lastX: event.clientX,
          alt: event.altKey,
          dragging: false,
        };
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
      if (scrubDrag) {
        if (!scrubDrag.dragging) {
          if (Math.abs(event.clientX - scrubDrag.startX) <= SCRUB_DRAG_THRESHOLD) return;
          scrubDrag.dragging = true;
          scrubDrag.lastX = event.clientX;
        }
        const dx = event.clientX - scrubDrag.lastX;
        scrubDrag.lastX = event.clientX;
        if (dx !== 0) {
          if (scrubDrag.kind === "zoom") {
            renderer.camera.zoomAt(scrubDrag.anchorX, scrubDrag.anchorY, Math.exp(dx * 0.01));
          } else {
            renderer.camera.rotateAt(scrubDrag.anchorX, scrubDrag.anchorY, dx * 0.01);
          }
        }
        return;
      }
      if (isPainting) {
        const world = worldFromEvent(event);
        stroke?.moveTo(world.x, world.y);
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (panOrigin) {
        panOrigin = null;
        restoreCursor();
      }
      if (scrubDrag && !scrubDrag.dragging) {
        if (scrubDrag.kind === "zoom") {
          renderer.camera.zoomAt(scrubDrag.anchorX, scrubDrag.anchorY, scrubDrag.alt ? 0.5 : 2);
        } else {
          renderer.camera.resetRotation(scrubDrag.anchorX, scrubDrag.anchorY);
        }
      }
      scrubDrag = null;
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
      {/* macOS-style menu bar */}
      <div style={menuBarStyle}>
        <MenuBar menus={menus} />
      </div>
      {/* Top options bar (contextual to the active tool) */}
      <div style={topBarStyle}>
        <span style={{ fontWeight: 700, minWidth: 52 }}>{TOOL_LABELS[tool]}</span>
        <div style={topBarDividerStyle} />
        {isPaintTool ? (
          <>
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
          </>
        ) : tool === "move" ? (
          <span style={{ ...fieldLabelStyle, flexShrink: 0 }}>Drag to pan</span>
        ) : tool === "zoom" ? (
          <span style={{ ...fieldLabelStyle, flexShrink: 0 }}>
            Click to zoom in · Alt+click to zoom out · drag horizontally
          </span>
        ) : (
          <>
            <span style={{ ...fieldLabelStyle, flexShrink: 0 }}>
              Drag horizontally to rotate · click to reset
            </span>
            <button
              type="button"
              style={topBtnStyle}
              onClick={() => rendererRef.current?.camera.resetRotation()}
            >
              Reset rotation
            </button>
          </>
        )}
      </div>

      {/* Left tool rail */}
      <div style={toolRailStyle}>
        {TOOL_RAIL.map(({ id, glyph, shortcut }) => (
          <button
            key={id}
            type="button"
            title={`${TOOL_LABELS[id]} (${shortcut})`}
            aria-pressed={tool === id}
            style={toolButtonStyle(tool === id)}
            onClick={() => setTool(id)}
          >
            {glyph}
          </button>
        ))}
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
