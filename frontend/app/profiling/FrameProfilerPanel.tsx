import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { FrameProfiler } from "./FrameProfiler";

export interface FrameProfilerPanelHandle {
  sample(timestamp: number, renderTimeMs: number): void;
}

export const FrameProfilerPanel = forwardRef<FrameProfilerPanelHandle>(function FrameProfilerPanel(_, ref) {
  const graphRef = useRef<HTMLCanvasElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const delayRef = useRef<HTMLSpanElement>(null);
  const renderTimeRef = useRef<HTMLSpanElement>(null);
  const profilerRef = useRef<FrameProfiler | null>(null);

  useImperativeHandle(ref, () => ({
    sample(timestamp, renderTimeMs) {
      if (!profilerRef.current) {
        const graph = graphRef.current;
        const fps = fpsRef.current;
        const delay = delayRef.current;
        const renderTime = renderTimeRef.current;
        if (!graph || !fps || !delay || !renderTime) return;
        profilerRef.current = new FrameProfiler({ graph, fps, delay, renderTime });
      }
      profilerRef.current.sample(timestamp, renderTimeMs);
    },
  }), []);

  useEffect(() => () => profilerRef.current?.dispose(), []);

  return (
    <div
      style={{
        width: "100%",
        boxSizing: "border-box",
        color: "var(--text)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.45,
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <strong ref={fpsRef}>-- FPS</strong>
        <span ref={delayRef}>Delay -- ms</span>
      </div>
      <canvas
        ref={graphRef}
        width={320}
        height={60}
        style={{ display: "block", width: "100%", height: 60, marginTop: 6 }}
      />
      <span ref={renderTimeRef}>Render -- ms</span>
    </div>
  );
});
