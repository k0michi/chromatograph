import Crypto
import Foundation
import Testing
@testable import ChromatographBackend

@Suite struct PatchPacketCodecTests {
  @Test func roundTripsContainerAndDerivesHash() throws {
    let key = String(repeating: "ab", count: 32)
    let payload = try OperationPacketCodec.encodePayload(operations: [], publicKeyHex: key, timestamp: 123)
    let patch = Patch(operations: [], publicKeyHex: key, timestamp: 123, hash: Data(SHA256.hash(data: payload)).cborHex,
      signatureHex: String(repeating: "ef", count: 64), images: [])
    #expect(try PatchPacketCodec.decode(PatchPacketCodec.encode(patch)) == patch)
  }

  @Test func rejectsTruncatedAndTrailingPackets() throws {
    let patch = Patch(operations: [], publicKeyHex: String(repeating: "ab", count: 32), timestamp: 0,
      hash: "", signatureHex: String(repeating: "ef", count: 64), images: [])
    let encoded = try PatchPacketCodec.encode(patch)
    #expect(throws: PatchPacketCodecError.truncatedPacket) { try PatchPacketCodec.decode(Data(encoded.dropLast())) }
    #expect(throws: PatchPacketCodecError.trailingBytes(1)) { try PatchPacketCodec.decode(encoded + Data([0])) }
  }
}
