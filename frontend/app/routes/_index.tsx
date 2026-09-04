import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Brush } from "~/canvas/brush/Brush";
import { BrushStroke } from "~/canvas/brush/BrushStroke";
import { RoundBrushTip } from "~/canvas/brush/RoundBrushTip";
import { StrokeSmoother, type ScreenStrokePoint } from "~/canvas/brush/StrokeSmoother";
import { CanvasRenderer, type OperationHistoryItem } from "~/canvas/CanvasRenderer";
import { OperationHistoryPanel } from "~/canvas/OperationHistoryPanel";
import { CanvasRulers, type CanvasRulersHandle } from "~/canvas/CanvasRulers";
import { CursorInspectorPanel, type CursorInspection } from "~/canvas/CursorInspectorPanel";
import { CompositeOp } from "~/canvas/Operation";
import { Client } from "~/network/Client";
import { NetworkDebugPanel } from "~/network/NetworkDebugPanel";
import { NetworkDebugStore } from "~/network/NetworkDebugStore";
import { FrameProfilerPanel, type FrameProfilerPanelHandle } from "~/profiling/FrameProfilerPanel";
import { MenuBar, type MenuBarMenu } from "~/ui/MenuBar";
import { PanelWindow } from "~/ui/PanelWindow";
import { useReader } from "~/store/Store";
import { KeyringStore } from "~/crypto/KeyringStore";
import { KeySettings } from "~/crypto/KeySettings";
import { ShortcutManager } from "~/ui/ShortcutManager";
import { ColorControl } from "~/ui/ColorControl";
import { ColorStore } from "~/color/ColorStore";
import { SwatchesPanel } from "~/color/SwatchesPanel";
import { createDefaultToolSettings, isPaintTool, TOOL_DEFINITIONS, TOOL_ORDER,
  toolForKey, updatePaintToolSettings, type PaintToolSettings, type ToolId } from "~/tools/ToolRegistry";
import type { Route } from "./+types/_index";

const MENU_BAR_HEIGHT = 28;
const OPTIONS_BAR_HEIGHT = 44;
const CHROME_TOP = MENU_BAR_HEIGHT + OPTIONS_BAR_HEIGHT;

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Chromatograph" }];
}

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
  const rulersRef = useRef<CanvasRulersHandle>(null);
  const networkDebugStore = useReader(NetworkDebugStore);
  const keyringStore = useReader(KeyringStore);
  const colorStore = useReader(ColorStore);
  const cursorScreenRef = useRef<{ x: number; y: number } | null>(null);
  const cursorNeedsInspectionRef = useRef(false);
  const [shortcuts, setShortcuts] = useState(ShortcutManager.nonApple);
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const [foregroundColor, setForegroundColor] = useState("#000000");
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const foregroundColorRef = useRef(foregroundColor);
  foregroundColorRef.current = foregroundColor;
  const [tool, setTool] = useState<ToolId>("brush");
  const [toolSettings, setToolSettings] = useState(createDefaultToolSettings);
  const [showGrid, setShowGrid] = useState(false);
  const [showRulers, setShowRulers] = useState(true);
  const [cursorInspection, setCursorInspection] = useState<CursorInspection | null>(null);
  const [operationHistory, setOperationHistory] = useState<readonly OperationHistoryItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const activeDefinition = TOOL_DEFINITIONS[tool];
  const activePaintSettings = isPaintTool(tool) ? toolSettings[tool] : null;
  const compositeOp = activeDefinition.compositeOp ?? CompositeOp.SourceOver;
  const updateActivePaintSettings = (patch: Partial<Omit<PaintToolSettings, "kind">>) => {
    if (!isPaintTool(tool)) return;
    setToolSettings((current) => updatePaintToolSettings(current, tool, patch));
  };
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const isSpaceHeldRef = useRef(false);
  const swapColors = () => {
    setForegroundColor(backgroundColor);
    setBackgroundColor(foregroundColor);
  };
  const swapColorsRef = useRef(swapColors);
  swapColorsRef.current = swapColors;
  const selectForegroundColor = (nextColor: string) => {
    setForegroundColor(nextColor);
  };
  const selectBackgroundColor = (nextColor: string) => {
    setBackgroundColor(nextColor);
  };

  const menus: MenuBarMenu[] = [
    {
      label: "Chromatograph",
      items: [{ label: "Settings…", shortcut: shortcuts.label("settings"), onSelect: () => setSettingsOpen(true) }],
    },
    {
      label: "Edit",
      items: [
        {
          label: "Undo",
          shortcut: shortcuts.label("undo"),
          disabled: () => !rendererRef.current?.canUndo,
          onSelect: () => void rendererRef.current?.undo(),
        },
        {
          label: "Redo",
          shortcut: shortcuts.label("redo"),
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
        {
          label: "Show Rulers",
          checked: showRulers,
          onSelect: () => setShowRulers((value) => !value),
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
          label: "Rotate 90°",
          onSelect: () => rendererRef.current?.camera.rotateBy(Math.PI / 2),
        },
        {
          label: "Rotate 180°",
          onSelect: () => rendererRef.current?.camera.rotateBy(Math.PI),
        },
        {
          label: "Rotate 270°",
          onSelect: () => rendererRef.current?.camera.rotateBy(-Math.PI / 2),
        },
        {
          label: "Reset Rotation",
          disabled: () => (rendererRef.current?.camera.rotation ?? 0) === 0,
          onSelect: () => rendererRef.current?.camera.resetRotation(),
        },
      ],
    },
  ];

  useEffect(() => {
    const brush = brushRef.current;
    if (!brush || !activePaintSettings) return;
    brush.settings.color = foregroundColor;
    brush.settings.size = activePaintSettings.size;
    brush.settings.hardness = activePaintSettings.hardness;
    brush.settings.opacity = activePaintSettings.opacity;
    brush.settings.spacing = activePaintSettings.spacing;
    brush.settings.smoothing = activePaintSettings.smoothing;
    brush.settings.compositeOp = compositeOp;
    brush.settings.pressureSize = activePaintSettings.penPressureSize ? 1 : 0;
    brush.settings.pressureOpacity = activePaintSettings.penPressureOpacity ? 1 : 0;
  }, [foregroundColor, activePaintSettings, compositeOp]);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.showGrid = showGrid;
  }, [showGrid]);

  useEffect(() => {
    if (showRulers) rendererRef.current?.invalidate();
  }, [showRulers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (isSpaceHeldRef.current) return;
    canvas.style.cursor = TOOL_DEFINITIONS[tool].cursor;
  }, [tool]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const client = new Client(window.location.href, {
      onError: (error) => console.error("Patch network error:", error),
    });
    const unsubscribePacketLogs = client.subscribePacketLogs((entry) => {
      networkDebugStore.append(entry);
    });
    const unsubscribeConnectionState = client.subscribeConnectionState((state) => {
      networkDebugStore.setConnectionState(state);
    });
    const renderer = new CanvasRenderer(canvas, client, () => keyringStore.activeIdentity());
    rendererRef.current = renderer;
    const unsubscribeHistory = renderer.onHistoryChanged(() => {
      setOperationHistory(renderer.operationHistory);
    });
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

    const initialPaintSettings = toolSettings.brush;
    const brush = new Brush({
      tip: new RoundBrushTip(),
      compositeOp: TOOL_DEFINITIONS.brush.compositeOp ?? CompositeOp.SourceOver,
      size: initialPaintSettings.size,
      hardness: initialPaintSettings.hardness,
      color: foregroundColor,
      opacity: initialPaintSettings.opacity,
      spacing: initialPaintSettings.spacing,
      smoothing: initialPaintSettings.smoothing,
      pressureSize: initialPaintSettings.penPressureSize ? 1 : 0,
      pressureOpacity: initialPaintSettings.penPressureOpacity ? 1 : 0,
    });
    brushRef.current = brush;
    let stroke: BrushStroke | null = null;
    let strokeSmoother: StrokeSmoother | null = null;

    let animationFrame: number | null = null;
    const renderFrame = (timestamp: number) => {
      animationFrame = null;
      const renderStart = performance.now();
      renderer.render();
      rulersRef.current?.update(renderer.camera, cursorScreenRef.current);
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
          startRotation: number;
          alt: boolean;
          dragging: boolean;
        }
      | null = null;
    let isPainting = false;
    let isSamplingColor = false;
    let sampleReadInFlight = false;
    let pendingSample: { x: number; y: number } | null = null;

    const drainColorSamples = async () => {
      if (sampleReadInFlight) return;
      sampleReadInFlight = true;
      try {
        while (pendingSample) {
          const sample = pendingSample;
          pendingSample = null;
          const rgba = await renderer.readSnapshotRgba(sample.x, sample.y);
          if (toolRef.current === "eyedropper") setForegroundColor(rgbHex(rgba));
        }
      } catch (error) {
        console.error("Failed to sample canvas color:", error);
      } finally {
        sampleReadInFlight = false;
        if (pendingSample) void drainColorSamples();
      }
    };

    const queueColorSample = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const world = renderer.camera.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      pendingSample = { x: world.x, y: world.y };
      void drainColorSamples();
    };

    const restoreCursor = () => {
      canvas.style.cursor = isSpaceHeldRef.current ? "grab" : TOOL_DEFINITIONS[toolRef.current].cursor;
    };

    const screenPointFromEvent = (event: PointerEvent): ScreenStrokePoint => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        pressure: pressureFromEvent(event),
        time: event.timeStamp,
      };
    };

    // Only pens report a meaningful pressure; mouse/touch always paint at full.
    const pressureFromEvent = (event: PointerEvent) =>
      event.pointerType === "pen" ? event.pressure : 1;

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
        if (key === "x") {
          swapColorsRef.current();
          return;
        }
        const shortcutTool = toolForKey(key);
        if (shortcutTool) return setTool(shortcutTool);
      }
      if (shortcutsRef.current.matches(event, "undo")) {
        event.preventDefault();
        void renderer.undo();
        return;
      }
      if (shortcutsRef.current.matches(event, "redo")) {
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
          startRotation: renderer.camera.rotation,
          alt: event.altKey,
          dragging: false,
        };
        return;
      }
      if (activeTool === "eyedropper") {
        isSamplingColor = true;
        queueColorSample(event);
        return;
      }
      if (activeTool === "brush") {
        void colorStore.remember(foregroundColorRef.current).catch((error: unknown) => {
          console.error("Failed to save used color:", error);
        });
      }
      isPainting = true;
      stroke = new BrushStroke(renderer, brush);
      let firstPoint = true;
      strokeSmoother = new StrokeSmoother(brush.settings.smoothing, (point) => {
        const world = renderer.camera.screenToWorld(point.x, point.y);
        if (firstPoint) {
          stroke?.begin(world.x, world.y, point.pressure);
          firstPoint = false;
        } else {
          stroke?.moveTo(world.x, world.y, point.pressure);
        }
      });
      strokeSmoother.begin(screenPointFromEvent(event));
    };
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      cursorScreenRef.current = { x: screenX, y: screenY };
      cursorNeedsInspectionRef.current = true;
      renderer.invalidate();
      if (isSamplingColor) {
        queueColorSample(event);
        return;
      }
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
            const freeRotation = scrubDrag.startRotation +
              (event.clientX - scrubDrag.startX) * 0.01;
            const snapStep = Math.PI / 4;
            const targetRotation = event.shiftKey
              ? Math.round(freeRotation / snapStep) * snapStep
              : freeRotation;
            renderer.camera.rotateAt(
              scrubDrag.anchorX,
              scrubDrag.anchorY,
              targetRotation - renderer.camera.rotation,
            );
          }
        }
        return;
      }
      if (isPainting) {
        const coalesced = event.getCoalescedEvents?.();
        const samples = coalesced?.length ? coalesced : [event];
        for (const sample of samples) strokeSmoother?.add(screenPointFromEvent(sample));
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (isSamplingColor && event.type === "pointerup") queueColorSample(event);
      isSamplingColor = false;
      if (event.type === "pointercancel") pendingSample = null;
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
      strokeSmoother?.end();
      strokeSmoother = null;
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
      unsubscribeHistory();
      client.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setShortcuts(ShortcutManager.detect());
  }, []);

  useEffect(() => {
    const onSettingsShortcut = (event: KeyboardEvent) => {
      if (shortcuts.matches(event, "settings")) {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onSettingsShortcut);
    return () => window.removeEventListener("keydown", onSettingsShortcut);
  }, [shortcuts]);

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
        <span style={{ fontWeight: 700, minWidth: 52 }}>{activeDefinition.label}</span>
        <div style={topBarDividerStyle} />
        {activePaintSettings ? (
          <>
            <label style={fieldStyle}>
              <span style={fieldLabelStyle}>Size</span>
              <input
                type="range"
                style={rangeStyle}
                min={2}
                max={200}
                value={activePaintSettings.size}
                onChange={(event) => updateActivePaintSettings({ size: Number(event.target.value) })}
              />
              <span style={fieldValueStyle}>{activePaintSettings.size}</span>
            </label>
            <label style={fieldStyle}>
              <span style={fieldLabelStyle}>Hardness</span>
              <input
                type="range"
                style={rangeStyle}
                min={0}
                max={1}
                step={0.01}
                value={activePaintSettings.hardness}
                onChange={(event) => updateActivePaintSettings({ hardness: Number(event.target.value) })}
              />
              <span style={fieldValueStyle}>{activePaintSettings.hardness.toFixed(2)}</span>
            </label>
            <label style={fieldStyle}>
              <span style={fieldLabelStyle}>Opacity</span>
              <input
                type="range"
                style={rangeStyle}
                min={0}
                max={1}
                step={0.01}
                value={activePaintSettings.opacity}
                onChange={(event) => updateActivePaintSettings({ opacity: Number(event.target.value) })}
              />
              <span style={fieldValueStyle}>{activePaintSettings.opacity.toFixed(2)}</span>
            </label>
            <label style={fieldStyle}>
              <span style={fieldLabelStyle}>Spacing</span>
              <input
                type="range"
                style={rangeStyle}
                min={0.01}
                max={1}
                step={0.01}
                value={activePaintSettings.spacing}
                onChange={(event) => updateActivePaintSettings({ spacing: Number(event.target.value) })}
              />
              <span style={fieldValueStyle}>{`${Math.round(activePaintSettings.spacing * 100)}%`}</span>
            </label>
            <label style={fieldStyle}>
              <span style={fieldLabelStyle}>Smoothing</span>
              <input
                type="range"
                style={rangeStyle}
                min={0}
                max={1}
                step={0.01}
                value={activePaintSettings.smoothing}
                onChange={(event) => updateActivePaintSettings({ smoothing: Number(event.target.value) })}
              />
              <span style={fieldValueStyle}>{activePaintSettings.smoothing.toFixed(2)}</span>
            </label>
            <div style={topBarDividerStyle} />
            <span style={{ ...fieldLabelStyle, flexShrink: 0 }}>Pen</span>
            <label style={{ ...fieldStyle, gap: 6 }}>
              <input
                type="checkbox"
                checked={activePaintSettings.penPressureSize}
                onChange={(event) => updateActivePaintSettings({ penPressureSize: event.target.checked })}
              />
              <span style={fieldLabelStyle}>Size</span>
            </label>
            <label style={{ ...fieldStyle, gap: 6 }}>
              <input
                type="checkbox"
                checked={activePaintSettings.penPressureOpacity}
                onChange={(event) => updateActivePaintSettings({ penPressureOpacity: event.target.checked })}
              />
              <span style={fieldLabelStyle}>Opacity</span>
            </label>
          </>
        ) : activeDefinition.options === "move" ? (
          <span style={{ ...fieldLabelStyle, flexShrink: 0 }}>Drag to pan</span>
        ) : activeDefinition.options === "zoom" ? (
          <span style={{ ...fieldLabelStyle, flexShrink: 0 }}>
            Click to zoom in · Alt+click to zoom out · drag horizontally
          </span>
        ) : activeDefinition.options === "eyedropper" ? (
          <span style={{ ...fieldLabelStyle, flexShrink: 0 }}>Click the canvas to sample a foreground color</span>
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
        {TOOL_ORDER.map((id) => {
          const definition = TOOL_DEFINITIONS[id];
          return (
          <button
            key={id}
            type="button"
            title={`${definition.label} (${definition.shortcut})`}
            aria-pressed={tool === id}
            style={toolButtonStyle(tool === id)}
            onClick={() => setTool(id)}
          >
            {definition.glyph}
          </button>
          );
        })}
        <div style={toolRailDividerStyle} />
        <ColorControl
          foreground={foregroundColor}
          background={backgroundColor}
          onForegroundChange={selectForegroundColor}
          onBackgroundChange={selectBackgroundColor}
          onSwap={swapColors}
          onReset={() => { selectForegroundColor("#000000"); selectBackgroundColor("#ffffff"); }}
        />
      </div>
      {showRulers ? <CanvasRulers ref={rulersRef} top={CHROME_TOP} left={52} right={300} /> : null}
      {/* Right sidebar (docked panels; will become movable windows later) */}
      <aside style={sidebarStyle}>
        <PanelWindow title="Swatches" contentPadding={0}>
          <SwatchesPanel currentColor={foregroundColor} onSelect={selectForegroundColor} />
        </PanelWindow>
        <PanelWindow title="History">
          <OperationHistoryPanel
            items={operationHistory}
            onSetActive={(id, active) => {
              void rendererRef.current?.setHistoryItemActive(id, active).catch((error: unknown) => {
                console.error("Failed to toggle history operation:", error);
              });
            }}
          />
        </PanelWindow>
        <PanelWindow title="Inspector">
          <CursorInspectorPanel inspection={cursorInspection} />
        </PanelWindow>
        <PanelWindow title="Performance">
          <FrameProfilerPanel ref={profilerRef} />
        </PanelWindow>
        <PanelWindow title="Network" defaultCollapsed>
          <NetworkDebugPanel />
        </PanelWindow>
      </aside>

      <KeySettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />

    </>
  );
}

function rgbHex(rgba: readonly [number, number, number, number]): string {
  return `#${rgba.slice(0, 3).map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}
