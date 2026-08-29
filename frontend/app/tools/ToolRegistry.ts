import { CompositeOp } from "~/canvas/Operation";

export type ToolId = "brush" | "eraser" | "move" | "zoom" | "rotate";
export type PaintToolId = "brush" | "eraser";

export interface PaintToolSettings {
  readonly kind: "paint";
  readonly size: number;
  readonly hardness: number;
  readonly opacity: number;
  readonly spacing: number;
  readonly smoothing: number;
  readonly penPressureSize: boolean;
  readonly penPressureOpacity: boolean;
}

export interface PassiveToolSettings {
  readonly kind: "passive";
}

export interface ToolSettingsMap {
  readonly brush: PaintToolSettings;
  readonly eraser: PaintToolSettings;
  readonly move: PassiveToolSettings;
  readonly zoom: PassiveToolSettings;
  readonly rotate: PassiveToolSettings;
}

export interface ToolDefinition {
  readonly id: ToolId;
  readonly label: string;
  readonly glyph: string;
  readonly shortcut: string;
  readonly keys: readonly string[];
  readonly cursor: string;
  readonly options: "paint" | "move" | "zoom" | "rotate";
  readonly compositeOp?: CompositeOp;
}

export const TOOL_DEFINITIONS: Readonly<Record<ToolId, ToolDefinition>> = {
  brush: { id: "brush", label: "Brush", glyph: "B", shortcut: "B", keys: ["b"], cursor: "crosshair",
    options: "paint", compositeOp: CompositeOp.SourceOver },
  eraser: { id: "eraser", label: "Eraser", glyph: "E", shortcut: "E", keys: ["e"], cursor: "crosshair",
    options: "paint", compositeOp: CompositeOp.DestinationOut },
  move: { id: "move", label: "Move", glyph: "M", shortcut: "H", keys: ["h", "v"], cursor: "grab", options: "move" },
  zoom: { id: "zoom", label: "Zoom", glyph: "Z", shortcut: "Z", keys: ["z"], cursor: "zoom-in", options: "zoom" },
  rotate: { id: "rotate", label: "Rotate", glyph: "R", shortcut: "R", keys: ["r"], cursor: "grab", options: "rotate" },
};

export function toolForKey(key: string): ToolId | null {
  return TOOL_ORDER.find((id) => TOOL_DEFINITIONS[id].keys.includes(key.toLowerCase())) ?? null;
}

export const TOOL_ORDER: readonly ToolId[] = ["brush", "eraser", "move", "zoom", "rotate"];

const defaultPaintSettings = (): PaintToolSettings => ({ kind: "paint", size: 40, hardness: 0.8,
  opacity: 1, spacing: 0.1, smoothing: 0.5, penPressureSize: true, penPressureOpacity: false });

export function createDefaultToolSettings(): ToolSettingsMap {
  return { brush: defaultPaintSettings(), eraser: defaultPaintSettings(),
    move: { kind: "passive" }, zoom: { kind: "passive" }, rotate: { kind: "passive" } };
}

export function updatePaintToolSettings(settings: ToolSettingsMap, tool: PaintToolId,
  patch: Partial<Omit<PaintToolSettings, "kind">>): ToolSettingsMap {
  return { ...settings, [tool]: { ...settings[tool], ...patch } };
}

export function isPaintTool(tool: ToolId): tool is PaintToolId {
  return tool === "brush" || tool === "eraser";
}
