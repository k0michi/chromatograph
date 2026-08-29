import { Store } from "~/store/Store";
import type { NetworkPacketLogEntry, WebSocketConnectionState } from "./Client";

export const RETAINED_NETWORK_ENTRY_COUNT = 500;

export class NetworkDebugStore extends Store {
  private retainedEntries: readonly NetworkPacketLogEntry[] = [];
  private currentConnectionState: WebSocketConnectionState = "disconnected";

  get entries(): readonly NetworkPacketLogEntry[] {
    return this.retainedEntries;
  }

  get connectionState(): WebSocketConnectionState {
    return this.currentConnectionState;
  }

  append(entry: NetworkPacketLogEntry): void {
    this.retainedEntries = [...this.retainedEntries, entry].slice(-RETAINED_NETWORK_ENTRY_COUNT);
    this.notifyListeners();
  }

  clear(): void {
    if (this.retainedEntries.length === 0) return;
    this.retainedEntries = [];
    this.notifyListeners();
  }

  setConnectionState(state: WebSocketConnectionState): void {
    if (this.currentConnectionState === state) return;
    this.currentConnectionState = state;
    this.notifyListeners();
  }
}
