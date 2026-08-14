import type { Patch } from "~/canvas/Patch";
import { PatchDecoder, PatchEncoder } from "~/canvas/serializePatch";
import { ChunkReplayPacketDecoder, type ChunkReplay } from "./ChunkReplayPacket";
import { SnapshotPacketDecoder, type ChunkSnapshotPacket } from "./SnapshotPacket";
import { containsChunk, sameChunkViewport, type ChunkCoordinate, type ChunkViewport } from "./ChunkViewport";

type SnapshotListener = (snapshots: readonly ChunkSnapshotPacket[]) => void;
type PatchListener = (patch: Patch) => void;
type WebSocketFactory = (url: string) => WebSocket;
type Fetch = (input: URL, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  readonly createWebSocket?: WebSocketFactory;
  readonly fetch?: Fetch;
  readonly onError?: (error: unknown) => void;
  readonly onClose?: (event: CloseEvent) => void;
}

export class Client implements Disposable {
  private static readonly connecting = 0;
  private static readonly open = 1;
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly patchListeners = new Set<PatchListener>();
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly pendingPackets: Uint8Array<ArrayBuffer>[] = [];
  private viewport: ChunkViewport | null = null;

  constructor(
    private readonly baseURL: string | URL,
    private readonly options: ClientOptions = {},
  ) { }

  get isConnected(): boolean {
    return this.socket?.readyState === Client.open;
  }

  connect(): Promise<void> {
    if (this.isConnected) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    const createWebSocket = this.options.createWebSocket ?? ((url) => new WebSocket(url));
    const socket = createWebSocket(this.url("/ws", "websocket").href);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let didOpen = false;
      socket.onopen = () => {
        didOpen = true;
        this.connectPromise = null;
        for (const packet of this.pendingPackets) socket.send(packet);
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
        if (!didOpen) reject(new Error(`Patch WebSocket closed before connecting (${event.code}).`));
      };
      socket.onmessage = (event) => this.receive(event.data);
    });
    return this.connectPromise;
  }

  send(patch: Patch): void {
    const socket = this.socket;
    if (!socket) throw new Error("Patch WebSocket is not connected.");
    const packet = PatchEncoder.encode(patch);
    if (socket.readyState === Client.connecting) {
      this.pendingPackets.push(packet);
      return;
    }
    if (socket.readyState !== Client.open) throw new Error("Patch WebSocket is not connected.");
    socket.send(packet);
  }

  setViewport(viewport: ChunkViewport): void {
    if (sameChunkViewport(this.viewport, viewport)) return;
    this.viewport = viewport;
  }

  async fetchChunkReplay(chunkX: number, chunkY: number, fromHash: string): Promise<ChunkReplay> {
    const url = this.url(`/api/chunks/${chunkX}/${chunkY}/replay`, "http");
    url.searchParams.set("from", fromHash);
    const request = this.options.fetch ?? ((input: URL, init?: RequestInit) => fetch(input, init));
    const response = await request(url);
    if (!response.ok) throw new Error(`Chunk replay failed (${response.status}).`);
    return ChunkReplayPacketDecoder.decode(await response.arrayBuffer());
  }

  async fetchSnapshots(chunks: readonly ChunkCoordinate[]): Promise<readonly ChunkSnapshotPacket[]> {
    if (chunks.length === 0) return [];
    const url = this.url("/api/snapshots", "http");
    const request = this.options.fetch ?? ((input: URL, init?: RequestInit) => fetch(input, init));
    const response = await request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunks }),
    });
    if (!response.ok) throw new Error(`Snapshot fetch failed (${response.status}).`);
    return SnapshotPacketDecoder.decode(await response.arrayBuffer());
  }

  subscribeSnapshots(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  subscribePatches(listener: PatchListener): () => void {
    this.patchListeners.add(listener);
    return () => this.patchListeners.delete(listener);
  }

  close(code = 1000, reason = "Client closed"): void {
    const socket = this.socket;
    this.socket = null;
    this.connectPromise = null;
    this.pendingPackets.length = 0;
    if (socket && (socket.readyState === Client.open || socket.readyState === Client.connecting)) {
      socket.close(code, reason);
    }
  }

  [Symbol.dispose](): void {
    this.close();
  }

  private url(path: string, kind: "http" | "websocket"): URL {
    const url = new URL(path, this.baseURL);
    if (kind === "websocket") {
      url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
    } else {
      url.protocol = url.protocol === "wss:" || url.protocol === "https:" ? "https:" : "http:";
    }
    return url;
  }

  private receive(data: unknown): void {
    if (!(data instanceof ArrayBuffer)) {
      this.options.onError?.(new Error("Patch WebSocket received a non-binary message."));
      return;
    }
    try {
      const view = new DataView(data);
      if (data.byteLength < 4) throw new Error("Truncated broadcast packet.");
      const kind = view.getUint32(0, false);
      const payload = data.slice(4);
      if (kind === 1) {
        const patch = PatchDecoder.decode(payload);
        if (!this.viewport || !patch.operations.some((operation) =>
          containsChunk(this.viewport!, operation.chunk.x, operation.chunk.y))) return;
        for (const listener of this.patchListeners) listener(patch);
      } else if (kind === 2) {
        const viewport = this.viewport;
        if (!viewport) return;
        const snapshots = SnapshotPacketDecoder.decode(payload)
          .filter((snapshot) => containsChunk(viewport, snapshot.chunk.x, snapshot.chunk.y))
          .map((snapshot) => ({
            ...snapshot,
            // A decoded PNG is a view into the complete WebSocket packet. Copy only
            // visible PNGs so the discarded snapshots do not keep that packet alive.
            imageBytes: snapshot.imageBytes.slice(),
          }));
        if (snapshots.length === 0) return;
        for (const listener of this.snapshotListeners) listener(snapshots);
      } else {
        throw new Error(`Unsupported broadcast packet kind ${kind}.`);
      }
    } catch (error) {
      this.options.onError?.(error);
    }
  }
}
