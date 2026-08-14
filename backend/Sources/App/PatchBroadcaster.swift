import Foundation
import Hummingbird
import HummingbirdWebSocket

actor PatchBroadcaster {
  typealias ConnectionID = UUID

  private struct Connection {
    let writer: WebSocketOutboundWriter
  }

  private var connections: [ConnectionID: Connection] = [:]
  private var latestSnapshots: [SnapshotKey: ChunkSnapshot] = [:]
  private var committedHashes: Set<String> = []
  private let chunks = ChunkManager()

  func addConnection(_ writer: WebSocketOutboundWriter) -> ConnectionID {
    let id = ConnectionID()
    connections[id] = Connection(writer: writer)
    return id
  }

  func remove(_ id: ConnectionID) {
    connections[id] = nil
  }

  func replay(x: Int32, y: Int32, from hash: String) async throws -> Data {
    try await ChunkReplayPacketCodec.encode(chunks.replay(x: x, y: y, from: hash))
  }

  func snapshots(chunks: [TileChunk]) throws -> Data {
    let keys = Set(chunks.map { SnapshotKey($0) })
    let availableSnapshots = keys.compactMap { latestSnapshots[$0] }
    let snapshots = availableSnapshots.sorted { lhs, rhs in
      lhs.chunk.x == rhs.chunk.x
        ? lhs.chunk.y < rhs.chunk.y
        : lhs.chunk.x < rhs.chunk.x
    }
    return try SnapshotPacketCodec.encode(snapshots)
  }

  func accept(_ patch: Patch) async throws {
    let responsePackets: [ByteBuffer]
    if !committedHashes.contains(patch.hash) {
      let snapshots = try await chunks.apply(patch)
      committedHashes.insert(patch.hash)
      for snapshot in snapshots {
        latestSnapshots[SnapshotKey(snapshot.chunk)] = snapshot
      }
      responsePackets = [
        ByteBuffer(
          bytes: BroadcastPacketCodec.encode(
            kind: .patch,
            payload: try PatchPacketCodec.encode(patch)
          )),
        ByteBuffer(
          bytes: BroadcastPacketCodec.encode(
            kind: .snapshots,
            payload: try SnapshotPacketCodec.encode(snapshots)
          )),
      ]
    } else {
      return
    }

    var disconnected: [ConnectionID] = []
    for id in Array(connections.keys) {
      guard let connection = connections[id] else { continue }
      do {
        for responsePacket in responsePackets {
          try await connection.writer.writeBinaryMessage(responsePacket)
        }
      } catch {
        disconnected.append(id)
      }
    }
    for id in disconnected {
      connections[id] = nil
    }
  }
}

private struct SnapshotKey: Hashable {
  let x: Int32
  let y: Int32

  init(_ chunk: TileChunk) {
    x = chunk.x
    y = chunk.y
  }
}
