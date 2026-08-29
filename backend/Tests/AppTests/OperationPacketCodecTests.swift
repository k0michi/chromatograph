import Foundation
import Testing

@testable import ChromatographBackend

@Suite
struct OperationPacketCodecTests {
    @Test
    func encodesTypeScriptCompatiblePacket() throws {
        let parent = String(repeating: "ab", count: 32)
        let operations: [ChromatographBackend.Operation] = [
            .blend(BlendOperation(
                chunk: TileChunk(x: 12, y: -5),
                parents: [parent],
                compositeOp: .destinationOut,
                blendMode: .multiply,
                opacity: 0.5,
                imageBytes: Data([0, 1, 2, 255])
            )),
            .undo(UndoOperation(chunk: TileChunk(x: -1, y: 2), parents: [])),
        ]

        let encoded = try OperationPacketCodec.encode(operations)
        let expectedHex =
            "82008288010c24815820" + parent +
            "01011a3f00000044000102ff" +
            "8402200280"

        #expect(encoded.hexStringForTest == expectedHex)
        #expect(try OperationPacketCodec.decode(encoded) == operations)
    }

    @Test
    func roundTripsEmptyPacket() throws {
        let encoded = try OperationPacketCodec.encode([])
        #expect(encoded == Data([0x82, 0x00, 0x80]))
        #expect(try OperationPacketCodec.decode(encoded).isEmpty)
    }

    @Test
    func rejectsInvalidParentHash() {
        let operation = Operation.undo(UndoOperation(
            chunk: TileChunk(x: 0, y: 0),
            parents: ["not-a-sha256"]
        ))
        #expect(throws: OperationPacketCodecError.invalidParentHash("not-a-sha256")) {
            try OperationPacketCodec.encode([operation])
        }
    }

    @Test
    func rejectsTruncatedAndTrailingPackets() throws {
        let valid = try OperationPacketCodec.encode([])
        #expect(throws: OperationPacketCodecError.truncatedPacket) {
            try OperationPacketCodec.decode(Data(valid.dropLast()))
        }
        #expect(throws: OperationPacketCodecError.trailingBytes(1)) {
            try OperationPacketCodec.decode(valid + Data([0]))
        }
    }
}

private extension Data {
    var hexStringForTest: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
