import type * as React from "react";

const iconButtonStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  display: "grid",
  placeItems: "center",
  padding: 0,
  border: "none",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
};

export function ColorControl({ foreground, background, onForegroundChange, onBackgroundChange,
  onSwap, onReset }: {
  readonly foreground: string;
  readonly background: string;
  readonly onForegroundChange: (color: string) => void;
  readonly onBackgroundChange: (color: string) => void;
  readonly onSwap: () => void;
  readonly onReset: () => void;
}) {
  return <div aria-label="Foreground and background colors"
    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
    <div style={{ width: 40, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <button type="button" title="Reset to black and white" aria-label="Reset colors to black and white"
        style={iconButtonStyle} onClick={onReset}><ResetColorsIcon /></button>
      <button type="button" title="Swap colors (X)" aria-label="Swap foreground and background colors"
        style={iconButtonStyle} onClick={onSwap}><SwapIcon /></button>
    </div>
    <div style={{ position: "relative", width: 38, height: 42 }}>
      <ColorSwatch label="Background color" color={background} onChange={onBackgroundChange}
        style={{ position: "absolute", left: 11, top: 13, zIndex: 0 }} />
      <ColorSwatch label="Foreground color" color={foreground} onChange={onForegroundChange}
        style={{ position: "absolute", left: 0, top: 0, zIndex: 1 }} />
    </div>
  </div>;
}

function ColorSwatch({ label, color, onChange, style }: {
  readonly label: string;
  readonly color: string;
  readonly onChange: (color: string) => void;
  readonly style: React.CSSProperties;
}) {
  return <label title={label} style={{ ...style, width: 27, height: 27, boxSizing: "border-box",
    borderRadius: 4, border: "2px solid var(--panel-bg)", outline: "1px solid var(--panel-border-strong)",
    background: color, cursor: "pointer" }}>
    <input aria-label={label} type="color" value={color} onChange={(event) => onChange(event.target.value)}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }} />
  </label>;
}

function SwapIcon() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M12.5 3.5H4m0 0 2.2-2.1M4 3.5l2.2 2.1M12.5 3.5V12m0 0-2.1-2.2m2.1 2.2 2.1-2.2"
      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function ResetColorsIcon() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
    <rect x="6.5" y="6.5" width="7" height="7" rx="1" fill="#fff" stroke="currentColor" />
    <rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="#000" stroke="currentColor" />
  </svg>;
}
