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
  func patchEndpointIsIdempotent() async throws {
    let patch = try testPatch(operations: [.blend(testBlendOperation(chunk: .init(x: 0, y: 0)))])
    let packet = ByteBuffer(bytes: try PatchPacketCodec.encode(patch))
    let app = try await buildApplication(reader: reader)
    try await app.test(.live) { client in
      try await client.execute(uri: "/api/patches", method: .post, body: packet) { response in
        #expect(response.status == .created)
      }
      try await client.execute(uri: "/api/patches", method: .post, body: packet) { response in
        #expect(response.status == .ok)
      }
    }
  }

  @Test
  func patchEndpointRejectsInvalidPacket() async throws {
    let app = try await buildApplication(reader: reader)
    try await app.test(.live) { client in
      try await client.execute(
        uri: "/api/patches", method: .post, body: ByteBuffer(bytes: [0, 1, 2])
      ) { response in
        #expect(response.status == .badRequest)
      }
    }
  }

  @Test
  func webSocketRejectsPatchUploads() async throws {
    let app = try await buildApplication(reader: reader)
    try await app.test(.live) { client in
      _ = try await client.ws("/ws") { inbound, outbound, _ in
        try await outbound.write(.binary(ByteBuffer(bytes: [0, 1, 2])))
        var iterator = inbound.messages(maxSize: .max).makeAsyncIterator()
        #expect(try await iterator.next() == .text("Patch uploads require POST /api/patches"))
      }
    }
  }

  @Test
  func patchEndpointRejectsInvalidPNG() async throws {
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
      try await client.execute(uri: "/api/patches", method: .post, body: packet) { response in
        #expect(response.status == .badRequest)
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
    let app = try await buildApplication(reader: reader)

    try await app.test(.live) { client in
      for patch in [firstPatch, secondPatch] {
        try await client.execute(
          uri: "/api/patches", method: .post,
          body: ByteBuffer(bytes: try PatchPacketCodec.encode(patch))
        ) { response in #expect(response.status == .created) }
      }
      let request = ByteBuffer(string: #"{"chunks":[{"x":2,"y":2}]}"#)
      try await client.execute(
        uri: "/api/snapshots", method: .post,
        headers: [.contentType: "application/json"], body: request
      ) { response in
        #expect(response.status == .ok)
        let snapshots = try SnapshotPacketCodec.decode(Data(response.body.readableBytesView))
        #expect(snapshots.map(\.headPatchHash) == [secondPatch.hash])
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
    images: hashes.compactMap(testImage(for:))
  )
}

nonisolated(unsafe) private var testImageRegistry: [String: Data] = [:]
private let testImageRegistryLock = NSLock()

private func registerTestImage(_ data: Data) -> String {
  let hash = Data(SHA256.hash(data: data)).hexString
  testImageRegistryLock.lock()
  defer { testImageRegistryLock.unlock() }
  testImageRegistry[hash] = data
  return hash
}

private func testImage(for hash: String) -> Data? {
  testImageRegistryLock.lock()
  defer { testImageRegistryLock.unlock() }
  return testImageRegistry[hash]
}

extension Data {
  fileprivate var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
