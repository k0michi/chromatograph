import Configuration
import Crypto
import Foundation
import Hummingbird
import HummingbirdTesting
import HummingbirdWSTesting
import Logging
import PNG
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
    func wsAcceptsPatchWithValidRGBA8PNG() async throws {
        let largePatch = try testPatch(operations: [
            .blend(BlendOperation(
                chunk: TileChunk(x: 0, y: 0),
                parents: [],
                compositeOp: .sourceOver,
                blendMode: .normal,
                opacity: 1,
                imageBytes: try testPNG()
            ))
        ])
        let packet = ByteBuffer(bytes: try PatchPacketCodec.encode(largePatch))

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
    func wsRejectsBlendWithInvalidPNG() async throws {
        let patch = try testPatch(operations: [
            .blend(BlendOperation(
                chunk: TileChunk(x: 0, y: 0),
                parents: [],
                compositeOp: .sourceOver,
                blendMode: .normal,
                opacity: 1,
                imageBytes: Data([0, 1, 2])
            ))
        ])
        let packet = ByteBuffer(bytes: try PatchPacketCodec.encode(patch))
        let app = try await buildApplication(reader: reader)
        try await app.test(.live) { client in
            _ = try await client.ws("/ws") { inbound, outbound, _ in
                try await outbound.write(.binary(packet))
                var iterator = inbound.messages(maxSize: .max).makeAsyncIterator()
                #expect(try await iterator.next() == .text("Invalid patch packet"))
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
                        #expect(try await iterator.next() == .binary(registrationPacket))
                        try await outbound.write(.binary(patchPacket))
                        #expect(try await iterator.next() == .binary(patchPacket))
                    }
                }
                try await group.waitForAll()
            }
        }
    }

    @Test
    func wsReplaysCommittedPatchesToNewConnectionsInOrder() async throws {
        let first = ByteBuffer(bytes: try PatchPacketCodec.encode(testPatch(
            operations: [.undo(UndoOperation(chunk: TileChunk(x: 1, y: 1), parents: []))]
        )))
        let second = ByteBuffer(bytes: try PatchPacketCodec.encode(testPatch(
            operations: [.undo(UndoOperation(chunk: TileChunk(x: 2, y: 2), parents: []))]
        )))
        let historyReady = AsyncGate()
        let app = try await buildApplication(reader: reader)

        try await app.test(.live) { client in
            try await withThrowingTaskGroup(of: Void.self) { group in
                group.addTask {
                    _ = try await client.ws("/ws") { inbound, outbound, _ in
                        var iterator = inbound.messages(maxSize: .max).makeAsyncIterator()
                        try await outbound.write(.binary(first))
                        #expect(try await iterator.next() == .binary(first))
                        try await outbound.write(.binary(second))
                        #expect(try await iterator.next() == .binary(second))
                        await historyReady.open()
                    }
                }
                group.addTask {
                    await historyReady.wait()
                    _ = try await client.ws("/ws") { inbound, _, _ in
                        var iterator = inbound.messages(maxSize: .max).makeAsyncIterator()
                        let replayedFirst = try await iterator.next()
                        let replayedSecond = try await iterator.next()
                        #expect(replayedFirst == .binary(first))
                        #expect(replayedSecond == .binary(second))
                    }
                }
                try await group.waitForAll()
            }
        }
    }
}

private struct PNGMemoryDestination: PNG.BytestreamDestination {
    var bytes: [UInt8] = []

    mutating func write(_ bytes: [UInt8]) -> Void? {
        self.bytes.append(contentsOf: bytes)
        return ()
    }
}

private func testPNG() throws -> Data {
    let pixels = [PNG.RGBA<UInt8>](
        repeating: .init(12, 34, 56, 78),
        count: 256 * 256
    )
    let image = PNG.Image(
        packing: pixels,
        size: (x: 256, y: 256),
        layout: .init(format: .rgba8(palette: [], fill: nil))
    )
    var destination = PNGMemoryDestination()
    try image.compress(stream: &destination, level: 3)
    return Data(destination.bytes)
}

private func testPatch(
    operations: [ChromatographBackend.Operation] = []
) throws -> Patch {
    let privateKey = try Curve25519.Signing.PrivateKey(
        rawRepresentation: Data(repeating: 0x42, count: 32)
    )
    let publicKey = privateKey.publicKey.rawRepresentation
    let operationBytes = try OperationPacketCodec.encode(operations)
    let hash = Data(SHA256.hash(data: operationBytes + publicKey))
    let signature = try privateKey.signature(for: hash)
    return Patch(
        operations: operations,
        publicKeyHex: publicKey.hexString,
        hash: hash.hexString,
        signatureHex: signature.hexString
    )
}

private extension Data {
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
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
