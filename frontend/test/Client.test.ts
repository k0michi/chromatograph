import { describe, expect, it, vi } from "vitest";
import { BlendMode, CompositeOp, type Operation } from "../app/canvas/Operation";
import { Patch } from "../app/canvas/Patch";
import { PatchDecoder, PatchEncoder } from "../app/canvas/serializePatch";
import { OperationDecoder, OperationEncoder } from "../app/canvas/serializeOperations";
import { BinaryWriter } from "../app/network/BinaryWriter";
import { Client } from "../app/network/Client";
import { MemoryPatchOutbox } from "../app/network/PatchOutbox";
import { PACKET_VERSION } from "../app/network/PacketVersion";

const operations: readonly Operation[] = [
  {
    type: "blend",
    chunk: { x: 12, y: -5 },
    parents: ["ab".repeat(32)],
    compositeOp: CompositeOp.DestinationOut,
    blendMode: BlendMode.Multiply,
    opacity: 0.5,
    imageBytes: new Uint8Array([0, 1, 2, 255]),
  },
  { type: "undo", chunk: { x: -1, y: 2 }, parents: [] },
];
const patch = Patch.fromEncoded(
  operations,
  "11".repeat(32),
  "22".repeat(32),
  "33".repeat(64),
);

describe("OperationDecoder", () => {
  it("decodes packets emitted by OperationEncoder", () => {
    expect(OperationDecoder.operations(OperationEncoder.operations(operations))).toEqual(operations);
  });

  it("rejects truncated and trailing packets", () => {
    const packet = OperationEncoder.operations([]);
    expect(() => OperationDecoder.operations(packet.slice(0, -1))).toThrow("Unexpected end of binary data");
    expect(() => OperationDecoder.operations(new Uint8Array([...packet, 0]))).toThrow("trailing byte");
  });
});

describe("Client", () => {
  it("connects, sends a Patch, and decodes a snapshot broadcast", async () => {
    const socket = new MockWebSocket();
    const listener = vi.fn();
    const packetLogger = vi.fn();
    const connectionStateListener = vi.fn();
    const client = new Client("ws://example.test/ws", {
      createWebSocket: () => socket as unknown as WebSocket,
    });
    client.subscribeSnapshots(listener);
    client.subscribePacketLogs(packetLogger);
    client.subscribeConnectionState(connectionStateListener);
    client.setViewport({ minX: 10, minY: -6, maxX: 13, maxY: -4 });

    const connecting = client.connect();
    socket.open();
    await connecting;
    expect(socket.binaryType).toBe("arraybuffer");
    expect(connectionStateListener.mock.calls.map(([state]) => state)).toEqual([
      "disconnected",
      "connected",
    ]);

    await client.send(patch);
    expect(socket.sent[0]).toEqual(PatchEncoder.encode(patch));

    const imageBytes = new Uint8Array([1, 2, 3]);
    socket.receive(broadcastPacket(2, snapshotPacket(12, -5, patch.hash, imageBytes)).buffer);
    expect(listener).toHaveBeenCalledWith([{
      chunk: { x: 12, y: -5 },
      headPatchHash: patch.hash,
      imageBytes,
    }]);
    expect(packetLogger).toHaveBeenCalledWith(expect.objectContaining({
      direction: "send",
      kind: "Patch",
      byteLength: PatchEncoder.encode(patch).byteLength,
    }));
    expect(packetLogger).toHaveBeenCalledWith(expect.objectContaining({
      direction: "receive",
      kind: "Snapshots",
      detail: "1 chunk(s)",
    }));
  });

  it("reports invalid messages without notifying subscribers", async () => {
    const socket = new MockWebSocket();
    const onError = vi.fn();
    const listener = vi.fn();
    const client = new Client("ws://example.test/ws", {
      createWebSocket: () => socket as unknown as WebSocket,
      onError,
    });
    client.subscribeSnapshots(listener);
    const connecting = client.connect();
    socket.open();
    await connecting;

    socket.receive(new Uint8Array([0, 1, 2]).buffer);
    expect(onError).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });

  it("ignores snapshots and patches outside the current viewport", async () => {
    const socket = new MockWebSocket();
    const snapshots = vi.fn();
    const patches = vi.fn();
    const client = new Client("ws://example.test/ws", {
      createWebSocket: () => socket as unknown as WebSocket,
    });
    client.subscribeSnapshots(snapshots);
    client.subscribePatches(patches);
    client.setViewport({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
    const connecting = client.connect();
    socket.open();
    await connecting;

    socket.receive(broadcastPacket(2, snapshotPacket(12, -5, patch.hash, new Uint8Array([1]))).buffer);
    socket.receive(broadcastPacket(1, PatchEncoder.encode(patch)).buffer);

    expect(snapshots).not.toHaveBeenCalled();
    expect(patches).not.toHaveBeenCalled();
  });

  it("queues patches while connecting", async () => {
    const socket = new MockWebSocket();
    const client = new Client("ws://example.test/ws", {
      createWebSocket: () => socket as unknown as WebSocket,
    });
    const connecting = client.connect();
    const sending = client.send(patch);
    expect(socket.sent).toHaveLength(0);

    socket.open();
    await connecting;
    await sending;
    expect(socket.sent).toHaveLength(1);
  });

  it("resends persisted patches after reload and removes them only after acknowledgement", async () => {
    const outbox = new MemoryPatchOutbox();
    const firstSocket = new MockWebSocket();
    const firstClient = new Client("ws://example.test/ws", {
      createWebSocket: () => firstSocket as unknown as WebSocket,
      patchOutbox: outbox,
    });
    const firstConnection = firstClient.connect();
    firstSocket.open();
    await firstConnection;
    await firstClient.send(patch);
    expect(await outbox.entries()).toHaveLength(1);
    firstClient.close();

    const secondSocket = new MockWebSocket();
    const secondClient = new Client("ws://example.test/ws", {
      createWebSocket: () => secondSocket as unknown as WebSocket,
      patchOutbox: outbox,
    });
    const secondConnection = secondClient.connect();
    secondSocket.open();
    await secondConnection;
    await vi.waitFor(() => expect(secondSocket.sent).toHaveLength(1));
    expect(secondSocket.sent[0]).toEqual(PatchEncoder.encode(patch));

    secondSocket.receive(broadcastPacket(3, new TextEncoder().encode(patch.hash)).buffer);
    await vi.waitFor(async () => expect(await outbox.entries()).toHaveLength(0));
    secondClient.close();
  });

  it("fetches and decodes a chunk replay over HTTPS", async () => {
    const imageBytes = new Uint8Array([137, 80, 78, 71]);
    const packet = chunkReplayPacket(imageBytes, [patch]);
    const request = vi.fn(async (_url: URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => packet.buffer,
    }) as Response);
    const client = new Client("wss://example.test/ws", { fetch: request });

    await expect(client.fetchChunkReplay(12, -5, patch.hash)).resolves.toEqual({
      containsEntireOrder: true,
      imageBytes,
      patches: [patch],
    });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]![0].href).toBe(
      `https://example.test/api/chunks/12/-5/replay?from=${patch.hash}`,
    );
  });

  it("fetches snapshots for a viewport over HTTPS", async () => {
    const imageBytes = new Uint8Array([1, 2, 3]);
    const packet = snapshotPacket(12, -5, patch.hash, imageBytes);
    const request = vi.fn(async (_url: URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => packet.buffer,
    }) as Response);
    const client = new Client("wss://example.test/ws", { fetch: request });

    await expect(client.fetchSnapshots([{ x: 12, y: -5 }]))
      .resolves.toEqual([{ chunk: { x: 12, y: -5 }, headPatchHash: patch.hash, imageBytes }]);
    expect(request.mock.calls[0]![0].href).toBe("https://example.test/api/snapshots");
    expect(request.mock.calls[0]![1]).toEqual({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunks: [{ x: 12, y: -5 }] }),
    });
  });

  it("shares in-flight snapshot requests for the same chunk", async () => {
    const imageBytes = new Uint8Array([1, 2, 3]);
    const packet = snapshotPacket(12, -5, patch.hash, imageBytes);
    let completeRequest!: (response: Response) => void;
    const request = vi.fn((_url: URL, _init?: RequestInit) => new Promise<Response>((resolve) => {
      completeRequest = resolve;
    }));
    const client = new Client("https://example.test", { fetch: request });

    const first = client.fetchSnapshots([{ x: 12, y: -5 }]);
    const second = client.fetchSnapshots([{ x: 12, y: -5 }]);
    expect(request).toHaveBeenCalledOnce();

    completeRequest({
      ok: true,
      status: 200,
      arrayBuffer: async () => packet.buffer,
    } as Response);
    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ chunk: { x: 12, y: -5 }, headPatchHash: patch.hash, imageBytes }],
      [{ chunk: { x: 12, y: -5 }, headPatchHash: patch.hash, imageBytes }],
    ]);
  });
});

describe("Patch packet codec", () => {
  it("round-trips the complete Patch", () => {
    expect(PatchDecoder.decode(PatchEncoder.encode(patch))).toEqual(patch);
  });

  it("rejects truncated and trailing Patch packets", () => {
    const packet = PatchEncoder.encode(patch);
    expect(() => PatchDecoder.decode(packet.slice(0, -1))).toThrow("Unexpected end of binary data");
    expect(() => PatchDecoder.decode(new Uint8Array([...packet, 0]))).toThrow("trailing byte");
  });
});

class MockWebSocket {
  binaryType: BinaryType = "blob";
  readyState = 0;
  readonly sent: unknown[] = [];
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  open(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  receive(data: ArrayBuffer): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  close(code = 1000): void {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
}

function snapshotPacket(
  x: number,
  y: number,
  hash: string,
  imageBytes: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const packet = new Uint8Array(8 + 4 + 4 + 32 + 4 + imageBytes.length);
  const view = new DataView(packet.buffer);
  view.setUint32(0, PACKET_VERSION, false);
  view.setUint32(4, 1, false);
  view.setInt32(8, x, false);
  view.setInt32(12, y, false);
  for (let index = 0; index < 32; index++) {
    packet[16 + index] = Number.parseInt(hash.slice(index * 2, index * 2 + 2), 16);
  }
  view.setUint32(48, imageBytes.length, false);
  packet.set(imageBytes, 52);
  return packet;
}

function broadcastPacket(kind: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const packet = new Uint8Array(4 + payload.length);
  new DataView(packet.buffer).setUint32(0, kind, false);
  packet.set(payload, 4);
  return packet;
}

function chunkReplayPacket(
  imageBytes: Uint8Array<ArrayBuffer>,
  patches: readonly Patch[],
): Uint8Array<ArrayBuffer> {
  const patchSequence = new BinaryWriter();
  patchSequence.writeUInt32(PACKET_VERSION);
  patchSequence.writeUInt32(patches.length);
  for (const value of patches) {
    const encoded = PatchEncoder.encode(value);
    patchSequence.writeUInt32(encoded.length);
    patchSequence.writeBytes(encoded);
  }
  const patchSequenceBytes = patchSequence.toBytes();

  const replay = new BinaryWriter();
  replay.writeUInt32(PACKET_VERSION);
  replay.writeUInt32(1);
  replay.writeUInt32(imageBytes.length);
  replay.writeBytes(imageBytes);
  replay.writeUInt32(patchSequenceBytes.length);
  replay.writeBytes(patchSequenceBytes);
  return replay.toBytes();
}
