import { describe, expect, it, vi } from "vitest";
import { BlendMode, CompositeOp, type Operation } from "../app/canvas/Operation";
import { Patch } from "../app/canvas/Patch";
import { PatchDecoder, PatchEncoder } from "../app/canvas/serializePatch";
import { OperationDecoder, OperationEncoder } from "../app/canvas/serializeOperations";
import { BinaryWriter } from "../app/network/BinaryWriter";
import { Client, PatchUploadError } from "../app/network/Client";
import { MemoryPatchOutbox } from "../app/network/PatchOutbox";
import { PACKET_VERSION } from "../app/network/PacketVersion";
import { Sha256 } from "../app/crypto/sha256";
import { Hex } from "../app/crypto/hex";
import { PATCH_FORMAT_VERSION } from "../app/canvas/Patch";
import { PatchPayloadEncoder, decodeCbor, encodeCbor } from "../app/canvas/serializeOperations";

const image = new Uint8Array([0, 1, 2, 255]);
const payloadHash = Hex.fromBytes(Sha256.digestSync(image));
const operations: readonly Operation[] = [
  {
    type: "blend",
    chunk: { x: 12, y: -5 },
    parent: "ab".repeat(32),
    compositeOp: CompositeOp.DestinationOut,
    blendMode: BlendMode.Multiply,
    opacity: 128,
    payloadHash,
  },
  { type: "undo", targetPatchHash: "ef".repeat(32) },
];
const fixturePayload = PatchPayloadEncoder.encode({ version: PATCH_FORMAT_VERSION, publicKeyHex: "11".repeat(32), timestamp: 123, operations });
const patch = Patch.fromEncoded(
  operations,
  "11".repeat(32),
  123,
  "33".repeat(64),
  [image],
  Hex.fromBytes(Sha256.digestSync(fixturePayload)),
);

describe("OperationDecoder", () => {
  it("decodes packets emitted by OperationEncoder", () => {
    expect(OperationDecoder.values(decodeCbor(encodeCbor(OperationEncoder.values(operations))) as unknown[])).toEqual(operations);
  });

  it("matches the Swift CBOR fixture", () => {
    expect(toHex(encodeCbor(OperationEncoder.values(operations)))).toBe(
      "8288005820" + "ab".repeat(32) + "0c24010118805820" + payloadHash + "82015820" + "ef".repeat(32),
    );
  });

  it("rejects truncated and trailing packets", () => {
    const packet = encodeCbor(OperationEncoder.values([]));
    expect(() => decodeCbor(packet.slice(0, -1))).toThrow("CBOR decode error");
    expect(() => decodeCbor(new Uint8Array([...packet, 0]))).toThrow("CBOR decode error");
  });
});

describe("Client", () => {
  it("connects, sends a Patch, and decodes a snapshot broadcast", async () => {
    const socket = new MockWebSocket();
    const listener = vi.fn();
    const packetLogger = vi.fn();
    const connectionStateListener = vi.fn();
    const request = vi.fn(async () => ({ ok: true, status: 201 }) as Response);
    const client = new Client("ws://example.test/ws", {
      createWebSocket: () => socket as unknown as WebSocket,
      fetch: request,
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
    expect(socket.sent).toHaveLength(0);
    expect(request).toHaveBeenCalledWith(new URL("http://example.test/api/patches"), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: PatchEncoder.encode(patch),
    });

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

  it("uploads patches over HTTP without waiting for the WebSocket", async () => {
    const socket = new MockWebSocket();
    const request = vi.fn(async () => ({ ok: true, status: 201 }) as Response);
    const client = new Client("ws://example.test/ws", {
      createWebSocket: () => socket as unknown as WebSocket,
      fetch: request,
    });
    await client.send(patch);
    expect(request).toHaveBeenCalledOnce();
    expect(socket.sent).toHaveLength(0);
  });

  it("keeps failed uploads and removes them after a successful retry", async () => {
    const outbox = new MemoryPatchOutbox();
    const firstClient = new Client("https://example.test", {
      fetch: async () => { throw new TypeError("Network unavailable"); },
      patchOutbox: outbox,
    });
    await expect(firstClient.send(patch)).rejects.toMatchObject({
      name: "PatchUploadError",
      retryable: true,
    });
    expect(await outbox.entries()).toHaveLength(1);

    const secondSocket = new MockWebSocket();
    const request = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    const secondClient = new Client("ws://example.test/ws", {
      createWebSocket: () => secondSocket as unknown as WebSocket,
      fetch: request,
      patchOutbox: outbox,
    });
    const secondConnection = secondClient.connect();
    secondSocket.open();
    await secondConnection;
    await vi.waitFor(async () => expect(await outbox.entries()).toHaveLength(0));
    expect(request).toHaveBeenCalledOnce();
    expect(secondSocket.sent).toHaveLength(0);
    secondClient.close();
  });

  it("classifies rejected Patch uploads as non-retryable and removes the poison entry", async () => {
    const outbox = new MemoryPatchOutbox();
    const client = new Client("https://example.test", {
      fetch: async () => ({ ok: false, status: 422 }) as Response,
      patchOutbox: outbox,
    });

    await expect(client.send(patch)).rejects.toEqual(
      expect.objectContaining<Partial<PatchUploadError>>({ status: 422, retryable: false }),
    );
    expect(await outbox.entries()).toHaveLength(0);
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

  it("treats a failed snapshot request as empty tiles", async () => {
    const request = vi.fn(async () => {
      throw new TypeError("Network unavailable");
    });
    const client = new Client("https://example.test", { fetch: request });

    await expect(client.fetchSnapshots([{ x: 12, y: -5 }])).resolves.toEqual([]);
    expect(request).toHaveBeenCalledOnce();
  });

  it("keeps a patch after an offline snapshot fallback", async () => {
    const outbox = new MemoryPatchOutbox();
    const socket = new MockWebSocket();
    const client = new Client("https://example.test", {
      createWebSocket: () => socket as unknown as WebSocket,
      fetch: async () => { throw new TypeError("Network unavailable"); },
      patchOutbox: outbox,
    });

    await expect(client.fetchSnapshots([{ x: 12, y: -5 }])).resolves.toEqual([]);
    await expect(client.send(patch)).rejects.toBeInstanceOf(PatchUploadError);
    expect(await outbox.entries()).toHaveLength(1);
    expect(socket.sent).toHaveLength(0);

  });
});

describe("Patch packet codec", () => {
  it("round-trips the complete Patch", () => {
    expect(PatchDecoder.decode(PatchEncoder.encode(patch))).toEqual(patch);
  });

  it("rejects truncated and trailing Patch packets", () => {
    const packet = PatchEncoder.encode(patch);
    expect(() => PatchDecoder.decode(packet.slice(0, -1))).toThrow("CBOR decode error");
    expect(() => PatchDecoder.decode(new Uint8Array([...packet, 0]))).toThrow("CBOR decode error");
  });
});

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
