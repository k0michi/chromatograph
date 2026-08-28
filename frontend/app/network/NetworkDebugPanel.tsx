import { forwardRef, useImperativeHandle, useState } from "react";
import type { NetworkPacketLogEntry } from "./Client";

const DEFAULT_VISIBLE_COUNT = 50;
const RETAINED_ENTRY_COUNT = 500;

export interface NetworkDebugPanelHandle {
  append(entry: NetworkPacketLogEntry): void;
}

function formatBytes(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  return `${(byteLength / 1024).toFixed(1)} KiB`;
}

export const NetworkDebugPanel = forwardRef<NetworkDebugPanelHandle>(function NetworkDebugPanel(_, ref) {
  const [entries, setEntries] = useState<readonly NetworkPacketLogEntry[]>([]);
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE_COUNT);

  useImperativeHandle(ref, () => ({
    append(entry) {
      setEntries((current) => [...current, entry].slice(-RETAINED_ENTRY_COUNT));
    },
  }), []);

  const visibleEntries = entries.slice(-visibleCount).reverse();

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        width: "min(32rem, calc(100vw - 24px))",
        maxHeight: "min(20rem, calc(100vh - 24px))",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        padding: 10,
        border: "1px solid rgba(255, 255, 255, 0.18)",
        borderRadius: 6,
        background: "rgba(10, 12, 14, 0.88)",
        color: "white",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.45,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <strong style={{ marginRight: "auto" }}>Network</strong>
        <label>
          Latest{" "}
          <input
            type="number"
            min={1}
            max={RETAINED_ENTRY_COUNT}
            value={visibleCount}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) {
                setVisibleCount(Math.min(RETAINED_ENTRY_COUNT, Math.max(1, Math.floor(value))));
              }
            }}
            style={{ width: 48, font: "inherit" }}
          />
        </label>
        <button type="button" onClick={() => setEntries([])} style={{ font: "inherit" }}>
          Clear
        </button>
      </div>
      <div style={{ minHeight: 24, overflowY: "auto" }}>
        {visibleEntries.length === 0 ? (
          <div style={{ opacity: 0.6 }}>No packets</div>
        ) : visibleEntries.map((entry) => (
          <div
            key={entry.sequence}
            style={{
              display: "grid",
              gridTemplateColumns: "5.5rem 1rem 7.5rem 4.5rem minmax(0, 1fr)",
              gap: 6,
              padding: "2px 0",
              borderTop: "1px solid rgba(255, 255, 255, 0.06)",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ opacity: 0.65 }}>
              {new Date(entry.timestamp).toLocaleTimeString(undefined, { hour12: false })}
            </span>
            <span style={{ color: entry.direction === "send" ? "#7dd3fc" : "#86efac" }}>
              {entry.direction === "send" ? "→" : "←"}
            </span>
            <span>{entry.kind}</span>
            <span style={{ textAlign: "right", opacity: 0.75 }}>{formatBytes(entry.byteLength)}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", opacity: 0.75 }}>
              {entry.detail}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});
