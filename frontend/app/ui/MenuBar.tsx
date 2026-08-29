import { useEffect, useRef, useState } from "react";

export interface MenuBarItem {
  readonly label: string;
  readonly onSelect?: () => void;
  readonly disabled?: boolean | (() => boolean);
  readonly checked?: boolean | (() => boolean);
  readonly separator?: boolean;
  readonly shortcut?: string;
}

export interface MenuBarMenu {
  readonly label: string;
  readonly items: readonly MenuBarItem[];
}

/**
 * A macOS-style menu bar. A menu opens on press (so press-and-hold works), and
 * while one is open you can drag onto an item and release to pick it, click an
 * item normally, hover across the bar to switch menus, or scroll the wheel to
 * cycle through them.
 */
export function MenuBar({ menus }: { menus: readonly MenuBarMenu[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // True between a press on a title and its release: a drag-to-select may be in
  // progress, and releasing off any item should dismiss the menu.
  const draggingRef = useRef(false);
  const dragOriginMenuRef = useRef<number | null>(null);
  const crossedMenuTitleRef = useRef(false);

  useEffect(() => {
    if (open === null) {
      draggingRef.current = false;
      dragOriginMenuRef.current = null;
      crossedMenuTitleRef.current = false;
      return;
    }
    const isInsideMenu = (node: Node | null) =>
      node instanceof Element && Boolean(node.closest("[data-menubar-root]"));
    const onPointerDownOutside = (event: PointerEvent) => {
      if (!isInsideMenu(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
      else if (event.key === "ArrowLeft") setOpen((i) => wrap((i ?? 0) - 1, menus.length));
      else if (event.key === "ArrowRight") setOpen((i) => wrap((i ?? 0) + 1, menus.length));
    };
    document.addEventListener("pointerdown", onPointerDownOutside, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownOutside, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, menus.length]);

  // Guards against a pointer-up being handled twice (once by the item, once by
  // the window drag-release fallback).
  const justSelectedRef = useRef(false);

  const select = (item: MenuBarItem) => {
    if (justSelectedRef.current) return;
    const isDisabled =
      typeof item.disabled === "function" ? item.disabled() : Boolean(item.disabled);
    if (isDisabled) return;
    justSelectedRef.current = true;
    setTimeout(() => {
      justSelectedRef.current = false;
    }, 0);
    draggingRef.current = false;
    setOpen(null);
    item.onSelect?.();
  };

  const selectFromElement = (element: Element | null | undefined): boolean => {
    const button = element?.closest<HTMLElement>("[data-menubar-item]");
    if (!button) return false;
    const menuIndex = Number(button.dataset.menu);
    const itemIndex = Number(button.dataset.item);
    const item = menus[menuIndex]?.items[itemIndex];
    if (item) select(item);
    return true;
  };

  return (
    <div
      ref={rootRef}
      data-menubar-root=""
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
              data-menubar-title=""
              data-menu={index}
              onPointerDown={(event) => {
                event.preventDefault();
                // Drop the implicit (touch) pointer capture so a drag onto an
                // item still delivers pointerup to that item.
                try {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                } catch {
                  // No capture to release.
                }
                if (isOpen) {
                  setOpen(null);
                  return;
                }
                setOpen(index);
                draggingRef.current = true;
                dragOriginMenuRef.current = index;
                crossedMenuTitleRef.current = false;
                // Registered synchronously so a fast drag-release is never missed.
                window.addEventListener(
                  "pointerup",
                  (up) => {
                    if (!draggingRef.current) return;
                    draggingRef.current = false;
                    const target = up.target as Element | null;
                    const atPoint = document.elementFromPoint(up.clientX, up.clientY);
                    if (selectFromElement(target) || selectFromElement(atPoint)) return;
                    // A plain press/release on the originating title enters click
                    // mode. Once the drag crosses another title, releasing without
                    // selecting an item ends the menu-tracking session.
                    if (crossedMenuTitleRef.current || !atPoint?.closest("[data-menubar-root]")) {
                      setOpen(null);
                    }
                  },
                  { once: true },
                );
              }}
              onPointerEnter={() => {
                if (draggingRef.current && dragOriginMenuRef.current !== index) {
                  crossedMenuTitleRef.current = true;
                }
                setOpen((current) => (current === null ? null : index));
              }}
              onClick={(event) => {
                // Keyboard activation (Enter/Space) reports detail 0.
                if (event.detail === 0) setOpen(isOpen ? null : index);
              }}
              onContextMenu={(event) => event.preventDefault()}
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
                  const checked =
                    typeof item.checked === "function" ? item.checked() : Boolean(item.checked);
                  return (
                    <button
                      key={itemIndex}
                      type="button"
                      role="menuitem"
                      data-menubar-item=""
                      data-menu={index}
                      data-item={itemIndex}
                      aria-disabled={disabled || undefined}
                      onPointerUp={() => select(item)}
                      onClick={(event) => {
                        // Pointer selection is handled on pointerup; this covers
                        // keyboard activation only (detail 0).
                        if (event.detail === 0) select(item);
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
                      <span style={{ width: 12, flexShrink: 0 }}>{checked ? "✓" : ""}</span>
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
