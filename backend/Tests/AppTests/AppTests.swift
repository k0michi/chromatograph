import Configuration
import Foundation
import Hummingbird
import HummingbirdTesting
import HummingbirdWSTesting
import Logging
import Testing

@testable import ChromatographBackend

private let reader = ConfigReader(providers: [
    InMemoryProvider(values: [
        "http.host": "127.0.0.1",
        "http.port": "0",
        "log.level": "trace",
    ])
])

@Suite
struct AppTests {
    @Test
    func hello() async throws {
        let app = try await buildApplication(reader: reader)
        try await app.test(.router) { client in
            try await client.execute(uri: "/", method: .get) { response in
                #expect(response.body == ByteBuffer(string: "Hello!"))
            }
        }
    }

    @Test
    func ws() async throws {
        let packet = ByteBuffer(bytes: try PatchPacketCodec.encode(testPatch()))
        let app = try await buildApplication(reader: reader)
        try await app.test(.live) { client in
            let closeFrame = try await client.ws("/ws") { inbound, outbound, context in
                try await outbound.write(.binary(packet))
                var inboundIterator = inbound.messages(maxSize: .max).makeAsyncIterator()
                let message = try await inboundIterator.next()
                #expect(message == .binary(packet))
            }
            #expect(closeFrame?.closeCode == .normalClosure)
        }
    }

    @Test
    func wsRejectsInvalidPatchPacket() async throws {
        let app = try await buildApplication(reader: reader)
        try await app.test(.live) { client in
            _ = try await client.ws("/ws") { inbound, outbound, _ in
                try await outbound.write(.binary(ByteBuffer(bytes: [0, 1, 2])))
                var inboundIterator = inbound.messages(maxSize: .max).makeAsyncIterator()
                #expect(try await inboundIterator.next() == .text("Invalid patch packet"))
            }
        }
    }

    @Test
    func wsAcceptsPatchLargerThanOneMegabyte() async throws {
        let largePatch = testPatch(operations: [
            .blend(BlendOperation(
                chunk: TileChunk(x: 0, y: 0),
                parents: [],
                compositeOp: .sourceOver,
                blendMode: .normal,
                opacity: 1,
                imageBytes: Data(repeating: 0x7f, count: 1_100_000)
            ))
        ])
        let packet = ByteBuffer(bytes: try PatchPacketCodec.encode(largePatch))
        #expect(packet.readableBytes > 1_000_000)

        let app = try await buildApplication(reader: reader)
        try await app.test(.live) { client in
            _ = try await client.ws(
                "/ws",
                configuration: .init(maxFrameSize: 64 * 1024 * 1024)
            ) { inbound, outbound, _ in
                try await outbound.write(.binary(packet))
                var iterator = inbound.messages(maxSize: .max).makeAsyncIterator()
                #expect(try await iterator.next() == .binary(packet))
            }
        }
    }

    @Test
    func wsBroadcastsPatchToOtherClients() async throws {
        let ready = AsyncGate()
        let registrationPacket = ByteBuffer(bytes: try PatchPacketCodec.encode(testPatch()))
        let patchPacket = ByteBuffer(bytes: try PatchPacketCodec.encode(testPatch(operations: [
            .undo(UndoOperation(chunk: TileChunk(x: 4, y: -2), parents: []))
        ])))
        let app = try await buildApplication(reader: reader)

        try await app.test(.live) { client in
            try await withThrowingTaskGroup(of: Void.self) { group in
                group.addTask {
                    _ = try await client.ws("/ws") { inbound, outbound, _ in
                        var iterator = inbound.messages(maxSize: .max).makeAsyncIterator()
                        try await outbound.write(.binary(registrationPacket))
                        #expect(try await iterator.next() == .binary(registrationPacket))
                        await ready.open()
                        #expect(try await iterator.next() == .binary(patchPacket))
                    }
                }
                group.addTask {
                    await ready.wait()
                    _ = try await client.ws("/ws") { inbound, outbound, _ in
                        var iterator = inbound.messages(maxSize: .max).makeAsyncIterator()
                        try await outbound.write(.binary(patchPacket))
                        #expect(try await iterator.next() == .binary(patchPacket))
                    }
                }
                try await group.waitForAll()
            }
        }
    }
}

private func testPatch(operations: [ChromatographBackend.Operation] = []) -> Patch {
    Patch(
        operations: operations,
        publicKeyHex: String(repeating: "11", count: 32),
        hash: String(repeating: "22", count: 32),
        signatureHex: String(repeating: "33", count: 64)
    )
}

private actor AsyncGate {
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        guard !isOpen else { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func open() {
        isOpen = true
        for waiter in waiters {
            waiter.resume()
        }
        waiters.removeAll()
    }
}
