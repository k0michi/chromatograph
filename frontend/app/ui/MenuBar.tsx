import { useEffect, useRef, useState } from "react";

export interface MenuBarItem {
  readonly label: string;
  readonly onSelect?: () => void;
  readonly disabled?: boolean | (() => boolean);
  readonly checked?: boolean;
  readonly separator?: boolean;
  readonly shortcut?: string;
}

export interface MenuBarMenu {
  readonly label: string;
  readonly items: readonly MenuBarItem[];
}

/**
 * A macOS-style menu bar: click a title to open it, and while a menu is open
 * moving the pointer over — or scrolling the wheel across — the bar switches
 * between menus.
 */
export function MenuBar({ menus }: { menus: readonly MenuBarMenu[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
      else if (event.key === "ArrowLeft") setOpen((i) => wrap((i ?? 0) - 1, menus.length));
      else if (event.key === "ArrowRight") setOpen((i) => wrap((i ?? 0) + 1, menus.length));
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, menus.length]);

  return (
    <div
      ref={rootRef}
      style={{ display: "flex", alignItems: "stretch", height: "100%" }}
      onWheel={(event) => {
        if (open === null) return;
        const step = Math.sign(event.deltaY || event.deltaX) || 1;
        setOpen((i) => wrap((i ?? 0) + step, menus.length));
      }}
    >
      {menus.map((menu, index) => {
        const isOpen = open === index;
        return (
          <div key={menu.label} style={{ position: "relative", display: "flex" }}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : index)}
              onPointerEnter={() => setOpen((current) => (current === null ? null : index))}
              style={{
                border: "none",
                background: isOpen ? "var(--accent-bg)" : "transparent",
                color: "var(--text)",
                font: "inherit",
                fontSize: 12,
                padding: "0 10px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {menu.label}
            </button>
            {isOpen && (
              <div
                role="menu"
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  minWidth: 208,
                  padding: "4px 0",
                  background: "var(--panel-bg-elevated)",
                  border: "1px solid var(--panel-border-strong)",
                  borderRadius: 6,
                  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
                  zIndex: 50,
                }}
              >
                {menu.items.map((item, itemIndex) => {
                  if (item.separator) {
                    return (
                      <div
                        key={itemIndex}
                        style={{ height: 1, margin: "4px 0", background: "var(--panel-border)" }}
                      />
                    );
                  }
                  const disabled =
                    typeof item.disabled === "function" ? item.disabled() : Boolean(item.disabled);
                  return (
                    <button
                      key={itemIndex}
                      type="button"
                      role="menuitem"
                      disabled={disabled}
                      onClick={() => {
                        setOpen(null);
                        item.onSelect?.();
                      }}
                      onPointerEnter={(event) => {
                        if (!disabled) event.currentTarget.style.background = "var(--accent-bg)";
                      }}
                      onPointerLeave={(event) => {
                        event.currentTarget.style.background = "transparent";
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                        width: "100%",
                        border: "none",
                        background: "transparent",
                        color: "var(--text)",
                        font: "inherit",
                        fontSize: 12,
                        textAlign: "left",
                        padding: "5px 12px",
                        cursor: disabled ? "default" : "pointer",
                        opacity: disabled ? 0.4 : 1,
                      }}
                    >
                      <span style={{ width: 12, flexShrink: 0 }}>{item.checked ? "✓" : ""}</span>
                      <span style={{ flex: 1 }}>{item.label}</span>
                      {item.shortcut && (
                        <span style={{ color: "var(--text-muted)" }}>{item.shortcut}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function wrap(index: number, length: number): number {
  return ((index % length) + length) % length;
}
