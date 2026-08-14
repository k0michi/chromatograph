import { forwardRef, useImperativeHandle, useRef } from "react";

export interface CanvasScaleBarHandle {
  update(zoom: number): void;
}

function nicePixelLength(target: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10]
    .map((factor) => factor * magnitude)
    .reduce((nearest, value) =>
      Math.abs(value - target) < Math.abs(nearest - target) ? value : nearest);
}

export const CanvasScaleBar = forwardRef<CanvasScaleBarHandle>(function CanvasScaleBar(_, ref) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    update(zoom) {
      const label = labelRef.current;
      const bar = barRef.current;
      if (!label || !bar || !Number.isFinite(zoom) || zoom <= 0) return;
      const worldPixels = nicePixelLength(120 / zoom);
      label.textContent = `${worldPixels.toLocaleString()} px`;
      bar.style.width = `${worldPixels * zoom}px`;
    },
  }), []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        alignSelf: "flex-end",
        marginRight: 4,
        color: "white",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1,
        pointerEvents: "none",
        filter: "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.9))",
      }}
    >
      <span ref={labelRef} style={{ marginBottom: 4 }}>100 px</span>
      <div
        ref={barRef}
        style={{
          width: 100,
          height: 7,
          boxSizing: "border-box",
          borderRight: "2px solid white",
          borderBottom: "2px solid white",
          borderLeft: "2px solid white",
        }}
      />
    </div>
  );
});
