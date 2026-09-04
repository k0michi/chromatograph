import type { Patch } from "~/canvas/Patch";
import { PatchDecoder, PatchEncoder } from "~/canvas/serializePatch";
import SymbolHelper from "~/polyfills/SymbolHelper";
import { ChunkReplayPacketDecoder, type ChunkReplay } from "./ChunkReplayPacket";
import { SnapshotPacketDecoder, type ChunkSnapshotPacket } from "./SnapshotPacket";
import { containsChunk, sameChunkViewport, type ChunkCoordinate, type ChunkViewport } from "./ChunkViewport";
import { createPatchOutbox, type PatchOutbox } from "./PatchOutbox";

type SnapshotListener = (snapshots: readonly ChunkSnapshotPacket[]) => void;
type PatchListener = (patch: Patch) => void;
type PacketLogListener = (entry: NetworkPacketLogEntry) => void;
type ConnectionStateListener = (state: WebSocketConnectionState) => void;
type WebSocketFactory = (url: string) => WebSocket;
type Fetch = (input: URL, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  readonly createWebSocket?: WebSocketFactory;
  readonly fetch?: Fetch;
  readonly onError?: (error: unknown) => void;
  readonly onClose?: (event: CloseEvent) => void;
  readonly patchOutbox?: PatchOutbox;
  readonly reconnectDelayMs?: number;
}

export interface NetworkPacketLogEntry {
  readonly sequence: number;
  readonly timestamp: number;
  readonly direction: "send" | "receive";
  readonly kind: "Patch" | "Snapshots" | "Acknowledgement" | "Unknown";
  readonly byteLength: number;
  readonly detail: string;
}

export type WebSocketConnectionState = "disconnected" | "connected";

export class PatchUploadError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = true,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PatchUploadError";
  }
}

export class Client implements Disposable {
  private static readonly connecting = 0;
  private static readonly open = 1;
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly patchListeners = new Set<PatchListener>();
  private readonly packetLogListeners = new Set<PacketLogListener>();
  private readonly connectionStateListeners = new Set<ConnectionStateListener>();
  private packetLogSequence = 0;
  private connectionState: WebSocketConnectionState = "disconnected";
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly patchOutbox: PatchOutbox;
  private outboxWriteChain: Promise<void> = Promise.resolve();
  private outboxFlushChain: Promise<void> = Promise.resolve();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByClient = false;
  private viewport: ChunkViewport | null = null;
  private readonly inflightSnapshots = new Map<string, Promise<ChunkSnapshotPacket | null>>();

  constructor(
    private readonly baseURL: string | URL,
    private readonly options: ClientOptions = {},
  ) {
    this.patchOutbox = options.patchOutbox ?? createPatchOutbox();
  }

  get isConnected(): boolean {
    return this.socket?.readyState === Client.open;
  }

  connect(): Promise<void> {
    this.closedByClient = false;
    if (this.isConnected) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.setConnectionState("disconnected");

    const createWebSocket = this.options.createWebSocket ?? ((url) => new WebSocket(url));
    const socket = createWebSocket(this.url("/ws", "websocket").href);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let didOpen = false;
      socket.onopen = () => {
        didOpen = true;
        this.connectPromise = null;
        this.clearReconnectTimer();
        this.setConnectionState("connected");
        void this.flushOutbox().catch((error: unknown) => this.options.onError?.(error));
        resolve();
      };
      socket.onerror = () => {
        const error = new Error("Patch WebSocket connection failed.");
        this.options.onError?.(error);
        if (!didOpen) {
          this.connectPromise = null;
          reject(error);
          if (!this.closedByClient) this.scheduleReconnect();
        }
      };
      socket.onclose = (event) => {
        if (this.socket === socket) {
          this.socket = null;
          this.connectPromise = null;
        }
        this.setConnectionState("disconnected");
        this.options.onClose?.(event);
        if (!this.closedByClient) {
          this.scheduleReconnect();
        }
        if (!didOpen) reject(new Error(`Patch WebSocket closed before connecting (${event.code}).`));
      };
      socket.onmessage = (event) => this.receive(event.data);
    });
    return this.connectPromise;
  }

  async send(patch: Patch): Promise<void> {
    const packet = PatchEncoder.encode(patch);
    const write = this.outboxWriteChain.then(() => this.patchOutbox.put({ hash: patch.hash, packet }));
    this.outboxWriteChain = write.catch(() => {});
    await write;

    await this.flushOutbox();
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
    const uniqueChunks = new Map(chunks.map((chunk) => [this.chunkKey(chunk), chunk]));
    const newChunks = [...uniqueChunks].filter(([key]) => !this.inflightSnapshots.has(key));
    if (newChunks.length > 0) {
      const batch = this.requestSnapshots(newChunks.map(([, chunk]) => chunk));
      for (const [key] of newChunks) {
        let tracked: Promise<ChunkSnapshotPacket | null>;
        tracked = batch
          .then((snapshots) => snapshots.get(key) ?? null)
          .finally(() => {
            if (this.inflightSnapshots.get(key) === tracked) this.inflightSnapshots.delete(key);
          });
        this.inflightSnapshots.set(key, tracked);
      }
    }
    const snapshots = await Promise.all(
      [...uniqueChunks.keys()].map((key) => this.inflightSnapshots.get(key)!),
    );
    return snapshots
      .filter((snapshot): snapshot is ChunkSnapshotPacket => snapshot !== null)
      .map((snapshot) => ({ ...snapshot, imageBytes: snapshot.imageBytes.slice() }));
  }

  private async requestSnapshots(
    chunks: readonly ChunkCoordinate[],
  ): Promise<ReadonlyMap<string, ChunkSnapshotPacket>> {
    try {
      const url = this.url("/api/snapshots", "http");
      const request = this.options.fetch ?? ((input: URL, init?: RequestInit) => fetch(input, init));
      const response = await request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunks }),
      });
      if (!response.ok) throw new Error(`Snapshot fetch failed (${response.status}).`);
      return new Map(SnapshotPacketDecoder.decode(await response.arrayBuffer()).map((snapshot) =>
        [this.chunkKey(snapshot.chunk), snapshot]));
    } catch {
      // A snapshot is only a cache of the tile state. While offline (or when the
      // cache cannot be decoded), treat every requested tile as the empty root.
      // Locally created patches are persisted separately in the outbox and will
      // be submitted when the WebSocket reconnects.
      return new Map();
    }
  }

  subscribeSnapshots(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  subscribePatches(listener: PatchListener): () => void {
    this.patchListeners.add(listener);
    return () => this.patchListeners.delete(listener);
  }

  subscribePacketLogs(listener: PacketLogListener): () => void {
    this.packetLogListeners.add(listener);
    return () => this.packetLogListeners.delete(listener);
  }

  subscribeConnectionState(listener: ConnectionStateListener): () => void {
    this.connectionStateListeners.add(listener);
    listener(this.connectionState);
    return () => this.connectionStateListeners.delete(listener);
  }

  close(code = 1000, reason = "Client closed"): void {
    this.closedByClient = true;
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    this.connectPromise = null;
    this.setConnectionState("disconnected");
    if (socket && (socket.readyState === Client.open || socket.readyState === Client.connecting)) {
      socket.close(code, reason);
    }
  }

  [SymbolHelper.dispose](): void {
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

  private chunkKey(chunk: ChunkCoordinate): string {
    return `${chunk.x},${chunk.y}`;
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
        this.logPacket("receive", "Patch", data.byteLength, `hash ${this.shortHash(patch.hash)}`);
        if (!this.viewport) return;
        const blendOperations = patch.operations.filter((operation) => operation.type === "blend");
        if (blendOperations.length > 0 && !blendOperations.some((operation) =>
          containsChunk(this.viewport!, operation.chunk.x, operation.chunk.y))) return;
        for (const listener of this.patchListeners) listener(patch);
      } else if (kind === 2) {
        const viewport = this.viewport;
        const decodedSnapshots = SnapshotPacketDecoder.decode(payload);
        this.logPacket("receive", "Snapshots", data.byteLength, `${decodedSnapshots.length} chunk(s)`);
        if (!viewport) return;
        const snapshots = decodedSnapshots
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
        this.logPacket("receive", "Unknown", data.byteLength, `kind ${kind}`);
        throw new Error(`Unsupported broadcast packet kind ${kind}.`);
      }
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  private flushOutbox(): Promise<void> {
    const flush = this.outboxFlushChain.then(async () => {
      const patches = await this.patchOutbox.entries();
      for (const patch of patches) {
        const request = this.options.fetch ?? ((input: URL, init?: RequestInit) => fetch(input, init));
        let response: Response;
        try {
          response = await request(this.url("/api/patches", "http"), {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: patch.packet,
          });
        } catch (cause) {
          throw new PatchUploadError("Patch upload failed because the server is unreachable.", undefined, true, { cause });
        }
        if (!response.ok) {
          const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
          if (!retryable) await this.patchOutbox.delete(patch.hash);
          throw new PatchUploadError(`Patch upload failed (${response.status}).`, response.status, retryable);
        }
        this.logPacket("send", "Patch", patch.packet.byteLength, `hash ${this.shortHash(patch.hash)}`);
        await this.patchOutbox.delete(patch.hash);
      }
    });
    this.outboxFlushChain = flush.catch(() => {});
    return flush;
  }

  private scheduleReconnect(delay = this.options.reconnectDelayMs ?? 1_000): void {
    if (this.closedByClient || this.isConnected || this.connectPromise || this.reconnectTimer) return;
    this.setConnectionState("disconnected");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error: unknown) => {
        this.options.onError?.(error);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private logPacket(
    direction: NetworkPacketLogEntry["direction"],
    kind: NetworkPacketLogEntry["kind"],
    byteLength: number,
    detail: string,
  ): void {
    const entry: NetworkPacketLogEntry = {
      sequence: ++this.packetLogSequence,
      timestamp: Date.now(),
      direction,
      kind,
      byteLength,
      detail,
    };
    for (const listener of this.packetLogListeners) listener(entry);
  }

  private shortHash(hash: string): string {
    return `${hash.slice(0, 12)}…`;
  }

  private setConnectionState(state: WebSocketConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    for (const listener of this.connectionStateListeners) listener(state);
  }
}
