import { describe, expect, it } from "vitest";
import { ShortcutManager } from "../app/ui/ShortcutManager";

function keyboardEvent(key: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    ...modifiers } as KeyboardEvent;
}

describe("ShortcutManager", () => {
  it("uses Command labels and shortcuts on Apple platforms", () => {
    const manager = new ShortcutManager("apple");
    expect(manager.label("settings")).toBe("⌘,");
    expect(manager.label("undo")).toBe("⌘Z");
    expect(manager.label("redo")).toBe("⇧⌘Z");
    expect(manager.matches(keyboardEvent("z", { metaKey: true }), "undo")).toBe(true);
    expect(manager.matches(keyboardEvent("z", { ctrlKey: true }), "undo")).toBe(false);
  });

  it("uses Control labels and conventional redo on other platforms", () => {
    const manager = new ShortcutManager("other");
    expect(manager.label("settings")).toBe("^,");
    expect(manager.label("undo")).toBe("^Z");
    expect(manager.label("redo")).toBe("^Y");
    expect(manager.matches(keyboardEvent("y", { ctrlKey: true }), "redo")).toBe(true);
    expect(manager.matches(keyboardEvent("z", { ctrlKey: true, shiftKey: true }), "redo")).toBe(false);
  });
});
