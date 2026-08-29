import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWatcher } from "~/store/Store";
import { ColorStore, MAX_COLOR_HISTORY, SWATCH_COLUMNS } from "./ColorStore";

interface ContextTarget { readonly index: number | null; readonly x: number; readonly y: number }

export function SwatchesPanel({ currentColor, onSelect }: {
  readonly currentColor: string;
  readonly onSelect: (color: string) => void;
}) {
  const colors = useWatcher(ColorStore);
  const [context, setContext] = useState<ContextTarget | null>(null);

  useEffect(() => {
    if (!context) return;
    const close = () => setContext(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); };
  }, [context]);

  const run = (operation: Promise<void>) => {
    setContext(null);
    void operation.catch((error: unknown) => console.error("Failed to update swatches:", error));
  };

  const openContext = (event: React.MouseEvent, index: number | null) => {
    event.preventDefault();
    event.stopPropagation();
    setContext({ index, x: event.clientX, y: event.clientY });
  };

  return <div>
    <div aria-label="Color history" style={{ ...gridStyle, minHeight: 15 }}>
      {colors.history.map((color, index) =>
        <Swatch key={`history-${index}`} color={color} label={`Recent color ${color}`}
          onClick={() => onSelect(color)} />)}
    </div>
    <div aria-label="Saved swatches" onContextMenu={(event) => openContext(event, null)}
      style={{ ...gridStyle, minHeight: colors.swatches.length <= SWATCH_COLUMNS ? undefined : 0,
        aspectRatio: colors.swatches.length <= SWATCH_COLUMNS ? `${SWATCH_COLUMNS} / 1` : undefined,
        cursor: "context-menu" }}>
      {colors.swatches.map((color, index) =>
        <Swatch key={`saved-${index}`} color={color} label={`Saved swatch ${color}`}
          onClick={() => onSelect(color)} onContextMenu={(event) => openContext(event, index)} />)}
    </div>
    {context && createPortal(<div role="menu" onPointerDown={(event) => event.stopPropagation()}
      style={{ position: "fixed", left: Math.min(context.x, window.innerWidth - 160),
        top: Math.min(context.y, window.innerHeight - 112), zIndex: 1000,
        minWidth: 126, padding: "4px 0", borderRadius: 6, background: "var(--panel-bg-elevated)",
        border: "1px solid var(--panel-border-strong)", boxShadow: "0 8px 24px rgba(0,0,0,.35)" }}>
      {context.index === null && <MenuItem label="Add current color"
        onSelect={() => run(colors.addSwatch(currentColor))} />}
      {context.index !== null && <>
        <MenuItem label="Add current color" onSelect={() => run(colors.addSwatch(currentColor))} />
        <MenuItem label="Replace with current" onSelect={() => run(colors.replaceSwatch(context.index!, currentColor))} />
        <MenuItem label="Delete swatch" destructive onSelect={() => run(colors.deleteSwatch(context.index!))} />
      </>}
    </div>, document.body)}
  </div>;
}

const gridStyle: React.CSSProperties = { display: "grid",
  gridTemplateColumns: `repeat(${SWATCH_COLUMNS}, minmax(0, 1fr))`, gap: 0 };

function Swatch({ color, label, onClick, onContextMenu }: {
  readonly color: string;
  readonly label: string;
  readonly onClick?: () => void;
  readonly onContextMenu?: (event: React.MouseEvent) => void;
}) {
  return <button type="button" aria-label={label} title={color} onClick={onClick} onContextMenu={onContextMenu}
    style={{ display: "block", aspectRatio: "1", minWidth: 0, padding: "0 1px 1px 0", border: 0,
      cursor: "pointer", background: "transparent" }}>
    <span aria-hidden="true" style={{ display: "block", width: "100%", height: "100%", background: color }} />
  </button>;
}

function MenuItem({ label, onSelect, destructive = false }: {
  readonly label: string; readonly onSelect: () => void; readonly destructive?: boolean;
}) {
  return <button type="button" role="menuitem" onClick={onSelect} style={{ display: "block", width: "100%",
    padding: "6px 10px", border: 0, background: "transparent", color: destructive ? "#ef8d8d" : "var(--text)",
    textAlign: "left", fontSize: 11, cursor: "pointer" }}>{label}</button>;
}
