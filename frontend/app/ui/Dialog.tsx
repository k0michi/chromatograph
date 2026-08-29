import { useEffect, useRef, type ReactNode } from "react";

export function Dialog({ open, title, onClose, children }: {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} aria-label={title} onCancel={(event) => {
      // File inputs also emit a bubbling `cancel` event when their picker is
      // dismissed. Only treat cancellation originating from the dialog itself
      // (for example Escape) as a request to close this surface.
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      onClose();
    }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      style={{ padding: 0, border: "1px solid var(--panel-border-strong)", borderRadius: 10,
        color: "var(--text)", background: "var(--panel-bg-elevated)",
        boxShadow: "0 24px 80px rgba(0,0,0,.5)", width: "min(820px, calc(100vw - 32px))",
        height: "min(580px, calc(100vh - 48px))", overflow: "hidden" }}>
      <div style={{ height: "100%" }}>{children}</div>
    </dialog>
  );
}

export function CloseIcon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}
