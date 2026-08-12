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
    private var committedPackets: [ByteBuffer] = []
    private var committedHashes: Set<String> = []

    func synchronize(_ writer: WebSocketOutboundWriter) async throws -> ConnectionID {
        let id = ConnectionID()
        connections[id] = Connection(writer: writer, isSynchronizing: true, queuedPackets: [])

        do {
            for packet in committedPackets {
                try await writer.writeBinaryMessage(packet)
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

    func accept(_ patch: Patch, packet: ByteBuffer) async {
        if committedHashes.insert(patch.hash).inserted {
            committedPackets.append(packet)
        }

        var disconnected: [ConnectionID] = []
        for id in Array(connections.keys) {
            guard var connection = connections[id] else { continue }
            if connection.isSynchronizing {
                connection.queuedPackets.append(packet)
                connections[id] = connection
                continue
            }
            do {
                try await connection.writer.writeBinaryMessage(packet)
            } catch {
                disconnected.append(id)
            }
        }
        for id in disconnected {
            connections[id] = nil
        }
    }
}
