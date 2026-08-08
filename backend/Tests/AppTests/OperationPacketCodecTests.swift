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
            "0000000100000002" +
            "000000010000000cfffffffb00000001" + parent +
            "00000001000000013f00000000000004000102ff" +
            "00000002ffffffff0000000200000000"

        #expect(encoded.hexStringForTest == expectedHex)
        #expect(try OperationPacketCodec.decode(encoded) == operations)
    }

    @Test
    func roundTripsEmptyPacket() throws {
        let encoded = try OperationPacketCodec.encode([])
        #expect(encoded == Data([0, 0, 0, 1, 0, 0, 0, 0]))
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
