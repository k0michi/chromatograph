import Foundation

struct ChunkReplay: Sendable {
  let containsEntireOrder: Bool
  let imageBytes: Data
  let patches: [Patch]
}

enum ChunkReplayPacketCodecError: Error {
  case packetTooLarge
}

enum ChunkReplayPacketCodec {
  static func encode(_ replay: ChunkReplay) throws -> Data {
    let patches = try encodePatches(replay.patches)
    guard
      let imageByteCount = UInt32(exactly: replay.imageBytes.count),
      let patchesByteCount = UInt32(exactly: patches.count)
    else { throw ChunkReplayPacketCodecError.packetTooLarge }

    var data = Data()
    write(packetVersion, to: &data)
    write(replay.containsEntireOrder ? 1 : 0, to: &data)
    write(imageByteCount, to: &data)
    data.append(replay.imageBytes)
    write(patchesByteCount, to: &data)
    data.append(patches)
    return data
  }

  private static func encodePatches(_ patches: [Patch]) throws -> Data {
    guard let count = UInt32(exactly: patches.count) else {
      throw ChunkReplayPacketCodecError.packetTooLarge
    }
    var data = Data()
    write(packetVersion, to: &data)
    write(count, to: &data)
    for patch in patches {
      let packet = try PatchPacketCodec.encode(patch)
      guard let byteCount = UInt32(exactly: packet.count) else {
        throw ChunkReplayPacketCodecError.packetTooLarge
      }
      write(byteCount, to: &data)
      data.append(packet)
    }
    return data
  }

  private static func write(_ value: UInt32, to data: inout Data) {
    var value = value.bigEndian
    withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
  }
}
