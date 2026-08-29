export type ShortcutId = "settings" | "undo" | "redo";
export type ShortcutPlatform = "apple" | "other";

interface ShortcutDefinition {
  readonly key: string;
  readonly shift?: boolean;
}

const COMMON: Record<Exclude<ShortcutId, "redo">, ShortcutDefinition> = {
  settings: { key: "," },
  undo: { key: "z" },
};

/** Centralizes platform detection, shortcut labels, and keyboard-event matching. */
export class ShortcutManager {
  static readonly nonApple = new ShortcutManager("other");

  constructor(readonly platform: ShortcutPlatform) {}

  static detect(navigatorValue: Navigator | undefined = globalThis.navigator): ShortcutManager {
    if (!navigatorValue) return ShortcutManager.nonApple;
    const platform = navigatorValue.platform ?? "";
    const userAgent = navigatorValue.userAgent ?? "";
    const isApple = /Mac|iPhone|iPad|iPod/i.test(`${platform} ${userAgent}`);
    return new ShortcutManager(isApple ? "apple" : "other");
  }

  label(id: ShortcutId): string {
    const definition = this.definition(id);
    const modifier = this.platform === "apple" ? "⌘" : "^";
    return `${definition.shift ? "⇧" : ""}${modifier}${definition.key.toUpperCase()}`;
  }

  matches(event: KeyboardEvent, id: ShortcutId): boolean {
    const definition = this.definition(id);
    const primaryPressed = this.platform === "apple" ? event.metaKey : event.ctrlKey;
    const otherPrimaryPressed = this.platform === "apple" ? event.ctrlKey : event.metaKey;
    return primaryPressed && !otherPrimaryPressed && !event.altKey &&
      event.shiftKey === Boolean(definition.shift) &&
      event.key.toLowerCase() === definition.key;
  }

  private definition(id: ShortcutId): ShortcutDefinition {
    if (id === "redo") return this.platform === "apple" ? { key: "z", shift: true } : { key: "y" };
    return COMMON[id];
  }
}
