import Configuration
import Crypto
import Foundation
import Hummingbird
import HummingbirdTesting
import HummingbirdWSTesting
import HummingbirdWebSocket
import LibPNG
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
  func ws() async throws {
    let patch = try testPatch(operations: [.blend(testBlendOperation(chunk: .init(x: 0, y: 0)))])
    let packet = ByteBuffer(bytes: try PatchPacketCodec.encode(patch))
    let app = try await buildApplication(reader: reader)
    try await app.test(.live) { client in
      let closeFrame = try await client.ws(
        "/ws", configuration: .init(maxFrameSize: 64 * 1024 * 1024)
      ) { inbound, outbound, context in
        try await outbound.write(.binary(packet))
        var inboundIterator = inbound.messages(maxSize: .max).makeAsyncIterator()
        _ = try await inboundIterator.next()  // Patch broadcast
        let message = try await inboundIterator.next()
        let snapshots = try snapshotData(message)
        #expect(snapshots.count == 1)
        #expect(snapshots[0].chunk == TileChunk(x: 0, y: 0))
        #expect(snapshots[0].headPatchHash == patch.hash)
        #expect(try acknowledgementHash(try await inboundIterator.next()) == patch.hash)
        try await outbound.write(.binary(packet))
        #expect(try acknowledgementHash(try await inboundIterator.next()) == patch.hash)
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
      .blend(
        BlendOperation(
          chunk: TileChunk(x: 0, y: 0),
          parent: rootPatchHash,
          compositeOp: .sourceOver,
          blendMode: .normal,
          opacity: 255,
          payloadHash: registerTestImage(try testPNG())
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
        _ = try await iterator.next()  // Patch broadcast
        let snapshots = try snapshotData(try await iterator.next())
        #expect(snapshots.count == 1)
        #expect(snapshots[0].headPatchHash == largePatch.hash)
        #expect(try acknowledgementHash(try await iterator.next()) == largePatch.hash)
      }
    }
  }

  @Test
  func wsRejectsBlendWithInvalidPNG() async throws {
    let patch = try testPatch(operations: [
      .blend(
        BlendOperation(
          chunk: TileChunk(x: 0, y: 0),
          parent: rootPatchHash,
          compositeOp: .sourceOver,
          blendMode: .normal,
          opacity: 255,
          payloadHash: registerTestImage(Data([0, 1, 2]))
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
    let registrationPatch = try testPatch(operations: [
      .blend(testBlendOperation(chunk: .init(x: 1, y: 1)))
    ])
    let broadcastPatch = try testPatch(operations: [
      .blend(testBlendOperation(chunk: .init(x: 4, y: -2)))
    ])
    let registrationPacket = ByteBuffer(bytes: try PatchPacketCodec.encode(registrationPatch))
    let patchPacket = ByteBuffer(bytes: try PatchPacketCodec.encode(broadcastPatch))
    let app = try await buildApplication(reader: reader)

    try await app.test(.live) { client in
      try await withThrowingTaskGroup(of: Void.self) { group in
        group.addTask {
          _ = try await client.ws(
            "/ws", configuration: .init(maxFrameSize: 64 * 1024 * 1024)
          ) { inbound, outbound, _ in
            var iterator = inbound.messages(maxSize: .max).makeAsyncIterator()
            try await outbound.write(.binary(registrationPacket))
            _ = try await iterator.next()  // Patch broadcast
            #expect(
              try snapshotData(try await iterator.next())[0].headPatchHash == registrationPatch.hash
            )
            #expect(try acknowledgementHash(try await iterator.next()) == registrationPatch.hash)
            await ready.open()
            _ = try await iterator.next()  // Patch broadcast
            #expect(
              try snapshotData(try await iterator.next())[0].headPatchHash == broadcastPatch.hash)
          }
        }
        group.addTask {
          await ready.wait()
          _ = try await client.ws(
            "/ws", configuration: .init(maxFrameSize: 64 * 1024 * 1024)
          ) { inbound, outbound, _ in
            var iterator = inbound.messages(maxSize: .max).makeAsyncIterator()
            try await outbound.write(.binary(patchPacket))
            _ = try await iterator.next()  // Patch broadcast
            #expect(
              try snapshotData(try await iterator.next())[0].headPatchHash == broadcastPatch.hash)
          }
        }
        try await group.waitForAll()
      }
    }
  }

  @Test
  func snapshotEndpointReturnsOnlyRequestedChunks() async throws {
    let firstPatch = try testPatch(operations: [
      .blend(testBlendOperation(chunk: .init(x: 1, y: 1)))
    ])
    let secondPatch = try testPatch(operations: [
      .blend(testBlendOperation(chunk: .init(x: 2, y: 2)))
    ])
    let first = ByteBuffer(bytes: try PatchPacketCodec.encode(firstPatch))
    let second = ByteBuffer(bytes: try PatchPacketCodec.encode(secondPatch))
    let historyReady = AsyncGate()
    let app = try await buildApplication(reader: reader)

    try await app.test(.live) { client in
      try await withThrowingTaskGroup(of: Void.self) { group in
        group.addTask {
          _ = try await client.ws(
            "/ws", configuration: .init(maxFrameSize: 64 * 1024 * 1024)
          ) { inbound, outbound, _ in
            var iterator = inbound.messages(maxSize: .max).makeAsyncIterator()
            try await outbound.write(.binary(first))
            _ = try await iterator.next()  // Patch broadcast
            #expect(try snapshotData(try await iterator.next())[0].headPatchHash == firstPatch.hash)
            #expect(try acknowledgementHash(try await iterator.next()) == firstPatch.hash)
            try await outbound.write(.binary(second))
            _ = try await iterator.next()  // Patch broadcast
            #expect(
              try snapshotData(try await iterator.next())[0].headPatchHash == secondPatch.hash)
            #expect(try acknowledgementHash(try await iterator.next()) == secondPatch.hash)
            await historyReady.open()
          }
        }
        group.addTask {
          await historyReady.wait()
          let request = ByteBuffer(string: #"{"chunks":[{"x":2,"y":2}]}"#)
          try await client.execute(
            uri: "/api/snapshots",
            method: .post,
            headers: [.contentType: "application/json"],
            body: request
          ) { response in
            #expect(response.status == .ok)
            let snapshots = try SnapshotPacketCodec.decode(Data(response.body.readableBytesView))
            #expect(snapshots.map(\.headPatchHash) == [secondPatch.hash])
          }
        }
        try await group.waitForAll()
      }
    }
  }
}

private func testPNG() throws -> Data {
  try encodeRGBA8([UInt8](repeating: 12, count: 256 * 256 * 4))
}

private func encodeRGBA8(_ pixels: [UInt8]) throws -> Data {
  let write = try WriteStruct.create()
  let info = try write.createInfoStruct()
  try write.setWriteData()
  try write.setIHDR(info, .init(width: 256, height: 256, bitDepth: 8, colorType: .rgba))
  try write.writeInfo(info)
  for offset in stride(from: 0, to: pixels.count, by: 256 * 4) {
    try write.writeRow(info, Array(pixels[offset..<(offset + 256 * 4)]))
  }
  try write.writeEnd(info)
  return try write.writeData()
}

private func testBlendOperation(chunk: TileChunk) throws -> BlendOperation {
  BlendOperation(
    chunk: chunk,
    parent: rootPatchHash,
    compositeOp: .sourceOver,
    blendMode: .normal,
    opacity: 255,
    payloadHash: registerTestImage(try testPNG())
  )
}

private func snapshotData(_ message: WebSocketMessage?) throws -> [ChunkSnapshot] {
  guard case .binary(let buffer) = message else {
    throw SnapshotTestError.expectedBinary
  }
  let packet = Data(buffer.readableBytesView)
  guard packet.count >= 4 else { throw SnapshotTestError.expectedBinary }
  let kind = packet.prefix(4).reduce(0) { ($0 << 8) | UInt32($1) }
  guard kind == BroadcastPacketCodec.Kind.snapshots.rawValue else {
    throw SnapshotTestError.expectedSnapshots
  }
  return try SnapshotPacketCodec.decode(Data(packet.dropFirst(4)))
}

private func acknowledgementHash(_ message: WebSocketMessage?) throws -> String {
  guard case .binary(let buffer) = message else {
    throw SnapshotTestError.expectedBinary
  }
  let packet = Data(buffer.readableBytesView)
  guard packet.count >= 4 else { throw SnapshotTestError.expectedBinary }
  let kind = packet.prefix(4).reduce(0) { ($0 << 8) | UInt32($1) }
  guard kind == BroadcastPacketCodec.Kind.patchAcknowledgement.rawValue else {
    throw SnapshotTestError.expectedAcknowledgement
  }
  guard let hash = String(data: packet.dropFirst(4), encoding: .utf8) else {
    throw SnapshotTestError.expectedAcknowledgement
  }
  return hash
}

private enum SnapshotTestError: Error {
  case expectedBinary
  case expectedSnapshots
  case expectedAcknowledgement
}

private func testPatch(
  operations: [ChromatographBackend.Operation] = []
) throws -> Patch {
  let privateKey = try Curve25519.Signing.PrivateKey(
    rawRepresentation: Data(repeating: 0x42, count: 32)
  )
  let publicKey = privateKey.publicKey.rawRepresentation
  let timestamp: UInt64 = 123
  let payload = try OperationPacketCodec.encodePayload(operations: operations, publicKeyHex: publicKey.hexString, timestamp: timestamp)
  let hash = Data(SHA256.hash(data: payload))
  let signature = try privateKey.signature(for: payload)
  let hashes = Set(operations.compactMap { if case .blend(let blend) = $0 { blend.payloadHash } else { nil } }).sorted()
  return Patch(
    operations: operations,
    publicKeyHex: publicKey.hexString,
    timestamp: timestamp,
    hash: hash.hexString,
    signatureHex: signature.hexString,
    images: hashes.compactMap { testImageRegistry[$0] }
  )
}

nonisolated(unsafe) private var testImageRegistry: [String: Data] = [:]
private func registerTestImage(_ data: Data) -> String {
  let hash = Data(SHA256.hash(data: data)).hexString
  testImageRegistry[hash] = data
  return hash
}

extension Data {
  fileprivate var hexString: String { map { String(format: "%02x", $0) }.joined() }
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
