import Foundation
import Hummingbird
import HummingbirdWebSocket

actor PatchBroadcaster {
  typealias ConnectionID = UUID

  private struct Connection {
    let writer: WebSocketOutboundWriter
  }

  private var connections: [ConnectionID: Connection] = [:]

  func addConnection(_ writer: WebSocketOutboundWriter) -> ConnectionID {
    let id = ConnectionID()
    connections[id] = Connection(writer: writer)
    return id
  }

  func remove(_ id: ConnectionID) {
    connections[id] = nil
  }

  func broadcast(patch: Patch, snapshots: [ChunkSnapshot]) async throws {
    let responsePackets = [
      ByteBuffer(bytes: BroadcastPacketCodec.encode(
        kind: .patch, payload: try PatchPacketCodec.encode(patch))),
      ByteBuffer(bytes: BroadcastPacketCodec.encode(
        kind: .snapshots, payload: try SnapshotPacketCodec.encode(snapshots))),
    ]

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
