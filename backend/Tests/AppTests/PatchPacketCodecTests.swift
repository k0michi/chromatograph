import Foundation
import Testing

@testable import ChromatographBackend

@Suite
struct PatchPacketCodecTests {
    @Test
    func roundTripsCompletePatch() throws {
        let patch = Patch(
            operations: [.undo(UndoOperation(chunk: TileChunk(x: 7, y: -3), parents: []))],
            publicKeyHex: String(repeating: "ab", count: 32),
            hash: String(repeating: "cd", count: 32),
            signatureHex: String(repeating: "ef", count: 64)
        )
        let encoded = try PatchPacketCodec.encode(patch)

        #expect(try PatchPacketCodec.decode(encoded) == patch)
        let expectedHex =
            "8500818402072280" +
            "5820" + String(repeating: "ab", count: 32) +
            "5820" + String(repeating: "cd", count: 32) +
            "5840" + String(repeating: "ef", count: 64)
        #expect(encoded.hexStringForTest == expectedHex)
    }

    @Test
    func rejectsInvalidFixedWidthFields() {
        let patch = Patch(
            operations: [],
            publicKeyHex: "ab",
            hash: String(repeating: "cd", count: 32),
            signatureHex: String(repeating: "ef", count: 64)
        )
        #expect(throws: PatchPacketCodecError.invalidPublicKey("ab")) {
            try PatchPacketCodec.encode(patch)
        }
    }

    @Test
    func rejectsTruncatedAndTrailingPackets() throws {
        let patch = Patch(
            operations: [],
            publicKeyHex: String(repeating: "ab", count: 32),
            hash: String(repeating: "cd", count: 32),
            signatureHex: String(repeating: "ef", count: 64)
        )
        let encoded = try PatchPacketCodec.encode(patch)
        #expect(throws: PatchPacketCodecError.truncatedPacket) {
            try PatchPacketCodec.decode(Data(encoded.dropLast()))
        }
        #expect(throws: PatchPacketCodecError.trailingBytes(1)) {
            try PatchPacketCodec.decode(encoded + Data([0]))
        }
    }
}

private extension Data {
    var hexStringForTest: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
