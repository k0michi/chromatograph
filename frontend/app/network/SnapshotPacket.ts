import { BinaryReader } from "./BinaryReader";
import { PACKET_VERSION } from "./PacketVersion";

export interface ChunkSnapshotPacket {
  readonly chunk: { readonly x: number; readonly y: number };
  readonly headPatchHash: string;
  readonly imageBytes: Uint8Array<ArrayBuffer>;
}

export class SnapshotPacketDecoder {
  static decode(packet: ArrayBuffer): readonly ChunkSnapshotPacket[] {
    const reader = BinaryReader.fromArrayBuffer(packet);
    const version = reader.readUInt32();
    if (version !== PACKET_VERSION) throw new Error(`Unsupported Snapshot packet version ${version}.`);
    const count = reader.readUInt32();
    const snapshots: ChunkSnapshotPacket[] = [];
    for (let index = 0; index < count; index++) {
      const x = reader.readInt32();
      const y = reader.readInt32();
      const headPatchHash = Array.from(reader.readBytes(32), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const imageBytes = reader.readBytes(reader.readUInt32());
      snapshots.push({ chunk: { x, y }, headPatchHash, imageBytes });
    }
    if (!reader.isAtEnd) throw new Error(`Snapshot packet has ${reader.remainingByteCount} trailing byte(s).`);
    return snapshots;
  }
}
