import { describe, expect, it, vi } from "vitest";
import { NetworkDebugStore, RETAINED_NETWORK_ENTRY_COUNT } from "~/network/NetworkDebugStore";

describe("NetworkDebugStore", () => {
  it("notifies subscribers and retains logs without a mounted panel", () => {
    const store = new NetworkDebugStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.append({
      sequence: 1,
      timestamp: 100,
      direction: "receive",
      kind: "Patch",
      byteLength: 20,
      detail: "test",
    });
    expect(store.entries).toHaveLength(1);
    expect(listener).toHaveBeenCalledOnce();
    expect(store.version).toBe(1);
  });

  it("keeps only the newest retained entries", () => {
    const store = new NetworkDebugStore();
    for (let sequence = 0; sequence <= RETAINED_NETWORK_ENTRY_COUNT; sequence++) {
      store.append({
        sequence,
        timestamp: sequence,
        direction: "send",
        kind: "Acknowledgement",
        byteLength: 1,
        detail: "",
      });
    }
    expect(store.entries).toHaveLength(RETAINED_NETWORK_ENTRY_COUNT);
    expect(store.entries[0].sequence).toBe(1);
  });
});
