import { worldToChunkPosition } from "./chunkSpace";

export interface CursorInspection {
  readonly screenX: number;
  readonly screenY: number;
  readonly worldX: number;
  readonly worldY: number;
  readonly rgba: readonly [number, number, number, number];
}

export interface CursorInspectorPanelProps {
  readonly inspection: CursorInspection | null;
}

export function CursorInspectorPanel({ inspection }: CursorInspectorPanelProps) {
  const rgba = inspection?.rgba;
  const position = inspection
    ? worldToChunkPosition(inspection.worldX, inspection.worldY)
    : null;
  const swatch = rgba ? `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3] / 255})` : "transparent";

  return (
    <div
      style={{
        width: "100%",
        boxSizing: "border-box",
        color: "var(--text)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.55,
        pointerEvents: "none",
      }}
    >
      {inspection && rgba ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
          <div>
            <div>Screen: {inspection.screenX.toFixed(2)}, {inspection.screenY.toFixed(2)}</div>
            <div>World: {inspection.worldX.toFixed(3)}, {inspection.worldY.toFixed(3)}</div>
            <div>Chunk: {position?.chunkX}, {position?.chunkY}</div>
            <div>Subchunk: {position?.subchunkX}, {position?.subchunkY}</div>
            <div>RGBA8: {rgba.join(", ")}</div>
            <div>
              RGBA: {rgba.map((channel) => (channel / 255).toFixed(4)).join(", ")}
            </div>
          </div>
          <span
            style={{
              width: 40,
              height: 40,
              alignSelf: "center",
              border: "1px solid var(--panel-border-strong)",
              background: swatch,
            }}
          />
        </div>
      ) : (
        <div style={{ opacity: 0.65 }}>Outside canvas</div>
      )}
    </div>
  );
}
