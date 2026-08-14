import type { Patch } from "~/canvas/Patch";
import { PatchDecoder } from "~/canvas/serializePatch";
import { BinaryReader } from "./BinaryReader";
import { PACKET_VERSION } from "./PacketVersion";

export interface ChunkReplay {
  readonly containsEntireOrder: boolean;
  readonly imageBytes: Uint8Array<ArrayBuffer>;
  readonly patches: readonly Patch[];
}

export class ChunkReplayPacketDecoder {
  static decode(packet: ArrayBuffer): ChunkReplay {
    const reader = BinaryReader.fromArrayBuffer(packet);
    const version = reader.readUInt32();
    if (version !== PACKET_VERSION) throw new Error(`Unsupported Chunk replay packet version ${version}.`);
    const containsEntireOrder = reader.readUInt32() !== 0;
    const imageBytes = reader.readBytes(reader.readUInt32());
    const patches = this.decodePatches(reader.readBytes(reader.readUInt32()).buffer);
    if (!reader.isAtEnd) throw new Error(`Chunk replay packet has ${reader.remainingByteCount} trailing byte(s).`);
    return { containsEntireOrder, imageBytes, patches };
  }

  private static decodePatches(packet: ArrayBuffer): readonly Patch[] {
    const reader = BinaryReader.fromArrayBuffer(packet);
    const version = reader.readUInt32();
    if (version !== PACKET_VERSION) throw new Error(`Unsupported Patch sequence version ${version}.`);
    const count = reader.readUInt32();
    const patches: Patch[] = [];
    for (let index = 0; index < count; index++) {
      patches.push(PatchDecoder.decode(reader.readBytes(reader.readUInt32())));
    }
    if (!reader.isAtEnd) throw new Error(`Patch sequence has ${reader.remainingByteCount} trailing byte(s).`);
    return patches;
  }
}
