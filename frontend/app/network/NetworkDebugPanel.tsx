import { useState } from "react";
import { useWatcher } from "~/store/Store";
import type { WebSocketConnectionState } from "./Client";
import { NetworkDebugStore, RETAINED_NETWORK_ENTRY_COUNT } from "./NetworkDebugStore";

const DEFAULT_VISIBLE_COUNT = 50;

const CONNECTION_STATE_VIEW: Record<WebSocketConnectionState, { readonly label: string; readonly color: string }> = {
  disconnected: { label: "Disconnected", color: "#f87171" },
  connected: { label: "Connected", color: "#4ade80" },
};

function formatBytes(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  return `${(byteLength / 1024).toFixed(1)} KiB`;
}

export function NetworkDebugPanel() {
  const store = useWatcher(NetworkDebugStore);
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE_COUNT);
  const visibleEntries = store.entries.slice(-visibleCount).reverse();
  const connectionView = CONNECTION_STATE_VIEW[store.connectionState];

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        color: "var(--text)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.45,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginRight: "auto" }}>
          <span
            aria-hidden="true"
            style={{ width: 7, height: 7, borderRadius: "50%", background: connectionView.color }}
          />
          WebSocket: {connectionView.label}
        </span>
        <label>
          Latest{" "}
          <input
            type="number"
            min={1}
            max={RETAINED_NETWORK_ENTRY_COUNT}
            value={visibleCount}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) {
                setVisibleCount(Math.min(RETAINED_NETWORK_ENTRY_COUNT, Math.max(1, Math.floor(value))));
              }
            }}
            style={{ width: 48, font: "inherit" }}
          />
        </label>
        <button type="button" onClick={() => store.clear()} style={{ font: "inherit" }}>
          Clear
        </button>
      </div>
      <div style={{ minHeight: 24, maxHeight: 240, overflowY: "auto", overflowX: "auto" }}>
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
              borderTop: "1px solid var(--hairline)",
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
}
