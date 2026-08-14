import Foundation

struct ChunkSnapshot: Equatable, Sendable {
  let chunk: TileChunk
  let headPatchHash: String
  let imageBytes: Data
}

enum SnapshotPacketCodecError: Error, Equatable {
  case invalidFormatVersion(UInt32)
  case invalidHeadPatchHash(String)
  case packetTooLarge
  case truncatedPacket
  case trailingBytes(Int)
}

enum SnapshotPacketCodec {
  static func encode(_ snapshots: [ChunkSnapshot]) throws -> Data {
    guard let count = UInt32(exactly: snapshots.count) else {
      throw SnapshotPacketCodecError.packetTooLarge
    }
    var writer = SnapshotPacketWriter()
    writer.append(packetVersion)
    writer.append(count)
    for snapshot in snapshots {
      guard
        let hash = Data(snapshotHexString: snapshot.headPatchHash),
        hash.count == 32
      else {
        throw SnapshotPacketCodecError.invalidHeadPatchHash(snapshot.headPatchHash)
      }
      guard let imageByteCount = UInt32(exactly: snapshot.imageBytes.count) else {
        throw SnapshotPacketCodecError.packetTooLarge
      }
      writer.append(snapshot.chunk.x)
      writer.append(snapshot.chunk.y)
      writer.append(hash)
      writer.append(imageByteCount)
      writer.append(snapshot.imageBytes)
    }
    return writer.data
  }

  static func decode(_ data: Data) throws -> [ChunkSnapshot] {
    var reader = SnapshotPacketReader(data: data)
    let version = try reader.readUInt32()
    guard version == packetVersion else {
      throw SnapshotPacketCodecError.invalidFormatVersion(version)
    }
    let count = try reader.readCount()
    var snapshots: [ChunkSnapshot] = []
    snapshots.reserveCapacity(count)
    for _ in 0..<count {
      let x = Int32(bitPattern: try reader.readUInt32())
      let y = Int32(bitPattern: try reader.readUInt32())
      let hash = try reader.readData(count: 32).snapshotHexString
      let image = try reader.readData(count: reader.readCount())
      snapshots.append(
        .init(
          chunk: .init(x: x, y: y),
          headPatchHash: hash,
          imageBytes: image
        ))
    }
    guard reader.remainingByteCount == 0 else {
      throw SnapshotPacketCodecError.trailingBytes(reader.remainingByteCount)
    }
    return snapshots
  }
}

private struct SnapshotPacketWriter {
  var data = Data()

  mutating func append(_ value: UInt32) {
    var value = value.bigEndian
    withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
  }

  mutating func append(_ value: Int32) {
    append(UInt32(bitPattern: value))
  }

  mutating func append(_ bytes: Data) {
    data.append(bytes)
  }
}

private struct SnapshotPacketReader {
  let data: Data
  private(set) var offset = 0

  var remainingByteCount: Int { data.count - offset }

  mutating func readUInt32() throws -> UInt32 {
    try readData(count: 4).reduce(0) { ($0 << 8) | UInt32($1) }
  }

  mutating func readCount() throws -> Int {
    guard let count = Int(exactly: try readUInt32()) else {
      throw SnapshotPacketCodecError.packetTooLarge
    }
    return count
  }

  mutating func readData(count: Int) throws -> Data {
    guard count >= 0, count <= remainingByteCount else {
      throw SnapshotPacketCodecError.truncatedPacket
    }
    defer { offset += count }
    return data.subdata(in: offset..<(offset + count))
  }
}

extension Data {
  fileprivate init?(snapshotHexString: String) {
    guard snapshotHexString.count.isMultiple(of: 2) else { return nil }
    var bytes: [UInt8] = []
    bytes.reserveCapacity(snapshotHexString.count / 2)
    var index = snapshotHexString.startIndex
    while index < snapshotHexString.endIndex {
      let next = snapshotHexString.index(index, offsetBy: 2)
      guard let byte = UInt8(snapshotHexString[index..<next], radix: 16) else { return nil }
      bytes.append(byte)
      index = next
    }
    self.init(bytes)
  }

  fileprivate var snapshotHexString: String {
    map { String(format: "%02x", $0) }.joined()
  }
}
