import { forwardRef, useImperativeHandle, useRef } from "react";
import type { Camera2D } from "./Camera2D";

const RULER_SIZE = 18;
const TARGET_MAJOR_SPACING = 80;

export interface CanvasRulersHandle {
  update(camera: Camera2D, cursor?: { x: number; y: number } | null): void;
}

interface CanvasRulersProps {
  top: number;
  left: number;
  right: number;
}

function niceStep(target: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(target, Number.EPSILON)));
  const normalized = target / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function prepareCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return context;
}

function colors() {
  const style = getComputedStyle(document.documentElement);
  return {
    background: style.getPropertyValue("--ruler-bg").trim() || "#202024",
    foreground: style.getPropertyValue("--ruler-fg").trim() || "rgba(255,255,255,.72)",
    border: style.getPropertyValue("--panel-border-strong").trim() || "rgba(255,255,255,.14)",
    marker: style.getPropertyValue("--accent").trim() || "#6ea8ff",
  };
}

function formatLabel(value: number, step: number): string {
  const decimals = step < 1 ? Math.min(3, Math.ceil(-Math.log10(step))) : 0;
  return value.toFixed(decimals).replace("-0", "0");
}

export const CanvasRulers = forwardRef<CanvasRulersHandle, CanvasRulersProps>(
  function CanvasRulers({ top, left, right }, ref) {
    const horizontalRef = useRef<HTMLCanvasElement>(null);
    const verticalRef = useRef<HTMLCanvasElement>(null);

    useImperativeHandle(ref, () => ({
      update(camera, cursor = null) {
        const horizontal = horizontalRef.current;
        const vertical = verticalRef.current;
        if (!horizontal || !vertical) return;
        const palette = colors();
        drawHorizontal(horizontal, camera, palette, cursor?.x);
        drawVertical(vertical, camera, palette, cursor?.y);
      },
    }), []);

    const common = {
      position: "fixed" as const,
      display: "block",
      background: "var(--ruler-bg)",
      zIndex: 19,
    };

    return (
      <>
        <div style={{ ...common, top, left, width: RULER_SIZE, height: RULER_SIZE,
          borderRight: "1px solid var(--panel-border-strong)", borderBottom: "1px solid var(--panel-border-strong)" }} />
        <canvas ref={horizontalRef} aria-label="Horizontal ruler" style={{ ...common,
          top, left: left + RULER_SIZE, right, width: `calc(100% - ${left + right + RULER_SIZE}px)`, height: RULER_SIZE }} />
        <canvas ref={verticalRef} aria-label="Vertical ruler" style={{ ...common,
          top: top + RULER_SIZE, left, bottom: 0, width: RULER_SIZE, height: `calc(100% - ${top + RULER_SIZE}px)` }} />
      </>
    );
  },
);

type Palette = ReturnType<typeof colors>;

function drawHorizontal(canvas: HTMLCanvasElement, camera: Camera2D, palette: Palette, cursorX?: number) {
  const context = prepareCanvas(canvas);
  if (!context) return;
  const rect = canvas.getBoundingClientRect();
  context.clearRect(0, 0, rect.width, rect.height);
  context.fillStyle = palette.background;
  context.fillRect(0, 0, rect.width, rect.height);
  context.strokeStyle = palette.border;
  context.beginPath(); context.moveTo(0, rect.height - 0.5); context.lineTo(rect.width, rect.height - 0.5); context.stroke();

  const origin = camera.worldToScreen(0, 0);
  const direction = camera.flipX ? -1 : 1;
  const start = ((rect.left - origin.x) / camera.zoom) * direction;
  const end = ((rect.right - origin.x) / camera.zoom) * direction;
  drawTicks(context, rect.width, start, end, false, palette);
  if (cursorX !== undefined && cursorX >= rect.left && cursorX <= rect.right) {
    context.strokeStyle = palette.marker;
    context.beginPath(); context.moveTo(cursorX - rect.left + 0.5, 0); context.lineTo(cursorX - rect.left + 0.5, rect.height); context.stroke();
  }
}

function drawVertical(canvas: HTMLCanvasElement, camera: Camera2D, palette: Palette, cursorY?: number) {
  const context = prepareCanvas(canvas);
  if (!context) return;
  const rect = canvas.getBoundingClientRect();
  context.clearRect(0, 0, rect.width, rect.height);
  context.fillStyle = palette.background;
  context.fillRect(0, 0, rect.width, rect.height);
  context.strokeStyle = palette.border;
  context.beginPath(); context.moveTo(rect.width - 0.5, 0); context.lineTo(rect.width - 0.5, rect.height); context.stroke();

  const origin = camera.worldToScreen(0, 0);
  const direction = camera.flipY ? -1 : 1;
  const start = ((rect.top - origin.y) / camera.zoom) * direction;
  const end = ((rect.bottom - origin.y) / camera.zoom) * direction;
  drawTicks(context, rect.height, start, end, true, palette);
  if (cursorY !== undefined && cursorY >= rect.top && cursorY <= rect.bottom) {
    context.strokeStyle = palette.marker;
    context.beginPath(); context.moveTo(0, cursorY - rect.top + 0.5); context.lineTo(rect.width, cursorY - rect.top + 0.5); context.stroke();
  }
}

function drawTicks(context: CanvasRenderingContext2D, length: number, start: number, end: number, vertical: boolean, palette: Palette) {
  const unitsPerPixel = Math.abs(end - start) / Math.max(length, 1);
  if (!Number.isFinite(unitsPerPixel) || unitsPerPixel === 0) return;
  const majorStep = niceStep(unitsPerPixel * TARGET_MAJOR_SPACING);
  const minorStep = majorStep / (majorStep / 10 ** Math.floor(Math.log10(majorStep)) === 2 ? 4 : 5);
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  const first = Math.ceil(low / minorStep) * minorStep;
  context.strokeStyle = palette.foreground;
  context.fillStyle = palette.foreground;
  context.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textBaseline = "top";

  for (let value = first, count = 0; value <= high + minorStep * 0.01 && count < 2000; value += minorStep, count++) {
    const position = ((value - start) / (end - start)) * length;
    const major = Math.abs(value / majorStep - Math.round(value / majorStep)) < 1e-6;
    const tick = major ? 8 : 4;
    context.beginPath();
    if (vertical) { context.moveTo(RULER_SIZE - tick, position + 0.5); context.lineTo(RULER_SIZE, position + 0.5); }
    else { context.moveTo(position + 0.5, RULER_SIZE - tick); context.lineTo(position + 0.5, RULER_SIZE); }
    context.stroke();
    if (major) {
      const label = formatLabel(value, majorStep);
      if (vertical) {
        context.save(); context.translate(1, position + 3); context.rotate(-Math.PI / 2); context.fillText(label, 0, 0); context.restore();
      } else context.fillText(label, position + 3, 2);
    }
  }
}
