import { useState } from "react";

export interface PanelWindowProps {
  readonly title: string;
  readonly defaultCollapsed?: boolean;
  readonly children: React.ReactNode;
}

/**
 * A titled, collapsible panel used inside the right sidebar. The header is
 * styled as a window title bar so these can later be detached into freely
 * movable floating windows.
 */
export function PanelWindow({ title, defaultCollapsed = false, children }: PanelWindowProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section
      style={{
        boxSizing: "border-box",
        border: "1px solid var(--panel-border-strong)",
        borderRadius: 6,
        background: "var(--panel-bg-elevated)",
        color: "var(--text)",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "5px 8px",
          border: "none",
          borderBottom: collapsed ? "none" : "1px solid var(--panel-border)",
          background: "var(--panel-header-bg)",
          color: "inherit",
          cursor: "pointer",
          font: "inherit",
          fontFamily: "sans-serif",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        <span style={{ opacity: 0.6, fontSize: 9 }}>{collapsed ? "▶" : "▼"}</span>
        {title}
      </button>
      {!collapsed && <div style={{ padding: 8 }}>{children}</div>}
    </section>
  );
}
