import Foundation
import Hummingbird
import HummingbirdWebSocket

actor PatchBroadcaster {
  typealias ConnectionID = UUID

  private struct Connection {
    let writer: WebSocketOutboundWriter
  }

  private var connections: [ConnectionID: Connection] = [:]
  private var committedHashes: Set<String> = []
  private let chunks: ChunkManager

  init(store: any ChunkStore = MemoryChunkStore()) {
    chunks = ChunkManager(store: store)
  }

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

  func snapshots(chunks: [TileChunk]) async throws -> Data {
    try await SnapshotPacketCodec.encode(self.chunks.latestSnapshots(for: chunks))
  }

  func accept(_ patch: Patch, from connectionID: ConnectionID) async throws {
    var responsePackets: [ByteBuffer] = []
    if !committedHashes.contains(patch.hash) {
      do {
        let snapshots = try await chunks.apply(patch)
        committedHashes.insert(patch.hash)
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
      } catch ChunkManagerError.duplicatePatch {
        // A client may retry after the server committed the Patch but its ACK was lost.
        committedHashes.insert(patch.hash)
      }
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

    if let sender = connections[connectionID] {
      try await sender.writer.writeBinaryMessage(ByteBuffer(
        bytes: BroadcastPacketCodec.encodePatchAcknowledgement(hash: patch.hash)
      ))
    }
  }
}
