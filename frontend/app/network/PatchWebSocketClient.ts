import type { Patch } from "~/canvas/Patch";
import { PatchDecoder, PatchEncoder } from "~/canvas/serializePatch";

type PatchListener = (patch: Patch) => void;
type WebSocketFactory = (url: string) => WebSocket;

export interface PatchWebSocketClientOptions {
  readonly createWebSocket?: WebSocketFactory;
  readonly onError?: (error: unknown) => void;
  readonly onClose?: (event: CloseEvent) => void;
}

export class PatchWebSocketClient implements Disposable {
  private static readonly connecting = 0;
  private static readonly open = 1;
  private readonly listeners = new Set<PatchListener>();
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly pendingPackets: Uint8Array<ArrayBuffer>[] = [];

  constructor(
    private readonly url: string,
    private readonly options: PatchWebSocketClientOptions = {},
  ) { }

  get isConnected(): boolean {
    return this.socket?.readyState === PatchWebSocketClient.open;
  }

  connect(): Promise<void> {
    if (this.isConnected) {
      return Promise.resolve();
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const createWebSocket = this.options.createWebSocket ?? ((url) => new WebSocket(url));
    const socket = createWebSocket(this.url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let didOpen = false;
      socket.onopen = () => {
        didOpen = true;
        this.connectPromise = null;
        for (const packet of this.pendingPackets) {
          socket.send(packet);
        }
        this.pendingPackets.length = 0;
        resolve();
      };
      socket.onerror = () => {
        const error = new Error("Patch WebSocket connection failed.");
        this.options.onError?.(error);
        if (!didOpen) {
          this.connectPromise = null;
          reject(error);
        }
      };
      socket.onclose = (event) => {
        if (this.socket === socket) {
          this.socket = null;
          this.connectPromise = null;
        }
        this.options.onClose?.(event);
        if (!didOpen) {
          reject(new Error(`Patch WebSocket closed before connecting (${event.code}).`));
        }
      };
      socket.onmessage = (event) => this.receive(event.data);
    });
    return this.connectPromise;
  }

  send(patch: Patch): void {
    const socket = this.socket;
    if (!socket) {
      throw new Error("Patch WebSocket is not connected.");
    }
    const packet = PatchEncoder.encode(patch);
    if (socket.readyState === PatchWebSocketClient.connecting) {
      this.pendingPackets.push(packet);
      return;
    }
    if (socket.readyState !== PatchWebSocketClient.open) {
      throw new Error("Patch WebSocket is not connected.");
    }
    socket.send(packet);
  }

  subscribe(listener: PatchListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(code = 1000, reason = "Client closed"): void {
    const socket = this.socket;
    this.socket = null;
    this.connectPromise = null;
    this.pendingPackets.length = 0;
    if (socket && (socket.readyState === PatchWebSocketClient.open || socket.readyState === PatchWebSocketClient.connecting)) {
      socket.close(code, reason);
    }
  }

  [Symbol.dispose](): void {
    this.close();
  }

  private receive(data: unknown): void {
    if (!(data instanceof ArrayBuffer)) {
      this.options.onError?.(new Error("Patch WebSocket received a non-binary message."));
      return;
    }
    try {
      const patch = PatchDecoder.decode(data);
      for (const listener of this.listeners) {
        listener(patch);
      }
    } catch (error) {
      this.options.onError?.(error);
    }
  }
}
