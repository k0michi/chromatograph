import { describe, expect, it, vi } from "vitest";
import { BlendMode, CompositeOp, type Operation } from "../app/canvas/Operation";
import { Patch } from "../app/canvas/Patch";
import { PatchDecoder, PatchEncoder } from "../app/canvas/serializePatch";
import { OperationDecoder, OperationEncoder } from "../app/canvas/serializeOperations";
import { PatchWebSocketClient } from "../app/network/PatchWebSocketClient";

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
    expect(() => OperationDecoder.operations(packet.slice(0, -1))).toThrow("Truncated operation packet");
    expect(() => OperationDecoder.operations(new Uint8Array([...packet, 0]))).toThrow("trailing byte");
  });
});

describe("PatchWebSocketClient", () => {
  it("connects, sends a patch, and decodes a broadcast", async () => {
    const socket = new MockWebSocket();
    const listener = vi.fn();
    const client = new PatchWebSocketClient("ws://example.test/ws", {
      createWebSocket: () => socket as unknown as WebSocket,
    });
    client.subscribe(listener);

    const connecting = client.connect();
    socket.open();
    await connecting;
    expect(socket.binaryType).toBe("arraybuffer");

    client.send(patch);
    expect(socket.sent[0]).toEqual(PatchEncoder.encode(patch));

    socket.receive(PatchEncoder.encode(patch).buffer);
    expect(listener).toHaveBeenCalledWith(patch);
  });

  it("reports invalid messages without notifying subscribers", async () => {
    const socket = new MockWebSocket();
    const onError = vi.fn();
    const listener = vi.fn();
    const client = new PatchWebSocketClient("ws://example.test/ws", {
      createWebSocket: () => socket as unknown as WebSocket,
      onError,
    });
    client.subscribe(listener);
    const connecting = client.connect();
    socket.open();
    await connecting;

    socket.receive(new Uint8Array([0, 1, 2]).buffer);
    expect(onError).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });

  it("queues patches while connecting", async () => {
    const socket = new MockWebSocket();
    const client = new PatchWebSocketClient("ws://example.test/ws", {
      createWebSocket: () => socket as unknown as WebSocket,
    });
    const connecting = client.connect();
    client.send(patch);
    expect(socket.sent).toHaveLength(0);

    socket.open();
    await connecting;
    expect(socket.sent).toHaveLength(1);
  });
});

describe("Patch packet codec", () => {
  it("round-trips the complete Patch", () => {
    expect(PatchDecoder.decode(PatchEncoder.encode(patch))).toEqual(patch);
  });

  it("rejects truncated and trailing Patch packets", () => {
    const packet = PatchEncoder.encode(patch);
    expect(() => PatchDecoder.decode(packet.slice(0, -1))).toThrow("Truncated Patch packet");
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
