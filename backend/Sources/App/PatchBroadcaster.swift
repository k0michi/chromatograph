import Foundation
import Hummingbird
import HummingbirdWebSocket

actor PatchBroadcaster {
    typealias ConnectionID = UUID

    private var connections: [ConnectionID: WebSocketOutboundWriter] = [:]

    func add(_ writer: WebSocketOutboundWriter) -> ConnectionID {
        let id = ConnectionID()
        connections[id] = writer
        return id
    }

    func remove(_ id: ConnectionID) {
        connections[id] = nil
    }

    func broadcast(_ packet: ByteBuffer) async {
        var disconnected: [ConnectionID] = []
        for (id, writer) in connections {
            do {
                try await writer.writeBinaryMessage(packet)
            } catch {
                disconnected.append(id)
            }
        }
        for id in disconnected {
            connections[id] = nil
        }
    }
}
