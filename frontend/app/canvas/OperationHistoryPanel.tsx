import type { OperationHistoryItem } from "./CanvasRenderer";

export interface OperationHistoryPanelProps {
  readonly items: readonly OperationHistoryItem[];
  readonly onSetActive: (id: string, active: boolean) => void;
}

export function OperationHistoryPanel({ items, onSetActive }: OperationHistoryPanelProps) {
  if (items.length === 0) {
    return <div style={{ color: "var(--text-muted)", fontSize: 11 }}>No local operations yet.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 240, overflowY: "auto" }}>
      {[...items].reverse().map((item, reverseIndex) => (
        <div
          key={item.id}
          style={{
            display: "grid",
            gridTemplateColumns: "22px minmax(0, 1fr) auto",
            alignItems: "center",
            gap: 6,
            padding: "5px 6px",
            borderRadius: 4,
            background: reverseIndex === 0 ? "var(--panel-header-bg)" : "transparent",
            opacity: item.active ? 1 : 0.52,
          }}
        >
          <button
            type="button"
            disabled={item.pending}
            title={item.active ? "Undo this operation" : "Redo this operation"}
            aria-label={item.active ? `Undo ${item.label}` : `Redo ${item.label}`}
            aria-pressed={item.active}
            onClick={() => onSetActive(item.id, !item.active)}
            style={{
              width: 22,
              height: 22,
              padding: 0,
              border: "1px solid var(--panel-border)",
              borderRadius: 4,
              background: "var(--panel-bg)",
              color: "inherit",
              cursor: item.pending ? "wait" : "pointer",
            }}
          >
            {item.pending ? "…" : item.active ? "●" : "○"}
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
              {item.label}
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: 9 }}>
              {new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              {` · ${item.chunkCount} chunk${item.chunkCount === 1 ? "" : "s"}`}
            </div>
          </div>
          <span style={{ color: "var(--text-muted)", fontSize: 9 }}>
            {item.active ? "Active" : "Undone"}
          </span>
        </div>
      ))}
    </div>
  );
}
