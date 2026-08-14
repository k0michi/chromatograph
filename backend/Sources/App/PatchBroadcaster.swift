import Foundation
import Hummingbird
import HummingbirdWebSocket

actor PatchBroadcaster {
  typealias ConnectionID = UUID

  private struct Connection {
    let writer: WebSocketOutboundWriter
    var isSynchronizing: Bool
    var queuedPackets: [ByteBuffer]
  }

  private var connections: [ConnectionID: Connection] = [:]
  private var latestSnapshots: [SnapshotKey: ChunkSnapshot] = [:]
  private var committedHashes: Set<String> = []
  private let chunks = ChunkManager()

  func synchronize(_ writer: WebSocketOutboundWriter) async throws -> ConnectionID {
    let id = ConnectionID()
    connections[id] = Connection(writer: writer, isSynchronizing: true, queuedPackets: [])

    do {
      let snapshots = latestSnapshots.values.sorted {
        $0.chunk.x == $1.chunk.x
          ? $0.chunk.y < $1.chunk.y
          : $0.chunk.x < $1.chunk.x
      }
      if !snapshots.isEmpty {
        try await writer.writeBinaryMessage(
          ByteBuffer(
            bytes: BroadcastPacketCodec.encode(
              kind: .snapshots,
              payload: try SnapshotPacketCodec.encode(snapshots)
            )))
      }

      while true {
        guard var connection = connections[id] else { return id }
        guard !connection.queuedPackets.isEmpty else {
          connection.isSynchronizing = false
          connections[id] = connection
          return id
        }
        let queued = connection.queuedPackets
        connection.queuedPackets.removeAll(keepingCapacity: true)
        connections[id] = connection
        for packet in queued {
          try await writer.writeBinaryMessage(packet)
        }
      }
    } catch {
      connections[id] = nil
      throw error
    }
  }

  func remove(_ id: ConnectionID) {
    connections[id] = nil
  }

  func replay(x: Int32, y: Int32, from hash: String) async throws -> Data {
    try await ChunkReplayPacketCodec.encode(chunks.replay(x: x, y: y, from: hash))
  }

  func accept(_ patch: Patch, packet: ByteBuffer) async throws {
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
      guard var connection = connections[id] else { continue }
      if connection.isSynchronizing {
        connection.queuedPackets.append(contentsOf: responsePackets)
        connections[id] = connection
        continue
      }
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
