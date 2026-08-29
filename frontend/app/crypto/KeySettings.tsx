import type * as React from "react";
import { useRef, useState } from "react";
import { useWatcher } from "~/store/Store";
import { CloseIcon, Dialog } from "~/ui/Dialog";
import { KeyringStore } from "./KeyringStore";

const buttonStyle: React.CSSProperties = { border: "1px solid var(--panel-border-strong)", borderRadius: 6,
  background: "var(--control-bg)", color: "var(--text)", padding: "7px 12px", fontSize: 12, cursor: "pointer" };

export function KeySettings({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const keyring = useWatcher(KeyringStore);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage(null);
    try { await operation(); } catch (error) {
      setMessage(error instanceof Error ? error.message : "The operation failed.");
    } finally { setBusy(false); }
  };

  return <Dialog open={open} title="Settings" onClose={onClose}>
    <div style={{ display: "grid", gridTemplateColumns: "190px minmax(0,1fr)", height: "100%", fontFamily: "sans-serif" }}>
      <aside style={{ padding: 16, background: "var(--panel-bg)", borderRight: "1px solid var(--panel-border)" }}>
        <div style={{ padding: "4px 8px 16px", fontSize: 15, fontWeight: 650 }}>Settings</div>
        <div aria-current="page" style={{ padding: "9px 10px", borderRadius: 6, background: "var(--accent-bg)",
          color: "var(--text)", fontSize: 12 }}>Signing keys</div>
      </aside>
      <main style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        <header style={{ display: "flex", alignItems: "center", padding: "18px 22px 14px",
          borderBottom: "1px solid var(--panel-border)" }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 650 }}>Signing keys</h1>
            <p style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: 12 }}>Choose the identity used to sign new paint operations.</p>
          </div>
          <button type="button" aria-label="Close settings" onClick={onClose} style={{ ...buttonStyle, padding: 7, display: "grid", placeItems: "center" }}><CloseIcon /></button>
        </header>
        <section style={{ padding: 22, overflowY: "auto", minHeight: 0, flex: "1 1 0" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <button disabled={busy} type="button" style={buttonStyle} onClick={() => void run(async () => { await keyring.generate(); })}>Generate key</button>
            <button disabled={busy} type="button" style={buttonStyle} onClick={() => fileInput.current?.click()}>Import…</button>
            <input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => {
              const file = event.target.files?.[0]; event.currentTarget.value = ""; if (!file) return;
              void run(async () => { await keyring.importKey(JSON.parse(await file.text()) as unknown); });
            }} />
          </div>
          {message && <div role="alert" style={{ marginBottom: 12, padding: "9px 11px", borderRadius: 6,
            border: "1px solid #c45b5b", color: "#ef9a9a", fontSize: 12 }}>{message}</div>}
          <div style={{ display: "grid", gap: 9 }}>
            {keyring.keys.map((key) => {
              const active = key.id === keyring.activeKeyId;
              return <div key={key.id} style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto",
                gap: 13, alignItems: "center", padding: 13, borderRadius: 8,
                border: `1px solid ${active ? "var(--accent)" : "var(--panel-border-strong)"}`,
                background: active ? "var(--accent-bg)" : "var(--control-bg)" }}>
                <input type="radio" name="active-key" checked={active} aria-label={`Use ${key.name}`}
                  onChange={() => void run(async () => { await keyring.select(key.id); })} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{key.name}</div>
                  <code title={key.publicKeyHex} style={{ display: "block", marginTop: 5, overflow: "hidden",
                    textOverflow: "ellipsis", color: "var(--text-muted)", fontSize: 11 }}>{key.publicKeyHex}</code>
                  <div style={{ marginTop: 5, color: "var(--text-muted)", fontSize: 10 }}>Created {new Date(key.createdAt).toLocaleString()}</div>
                </div>
                <div style={{ display: "flex", gap: 7 }}>
                  <button disabled={busy} type="button" style={buttonStyle} onClick={() => void run(async () => {
                    const exported = await keyring.exportKey(key.id);
                    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
                    anchor.href = url; anchor.download = `${key.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "key"}.chromatograph-key.json`;
                    anchor.click(); URL.revokeObjectURL(url);
                  })}>Export…</button>
                  <button disabled={busy} type="button" style={{ ...buttonStyle, color: "#ef8d8d" }}
                    onClick={() => {
                      if (!window.confirm(`Delete “${key.name}”? This cannot be undone.`)) return;
                      void run(async () => { await keyring.deleteKey(key.id); });
                    }}>Delete</button>
                </div>
              </div>;
            })}
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5, margin: "16px 2px 0" }}>
            Exported files contain private signing material. Store them securely and only import files you trust.
          </p>
        </section>
      </main>
    </div>
  </Dialog>;
}
