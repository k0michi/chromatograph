import CBOR
import Foundation
import Testing
@testable import ChromatographBackend

@Suite struct OperationPacketCodecTests {
  @Test func encodesNewMetadataOnlySchema() throws {
    let parent = String(repeating: "ab", count: 32), payload = String(repeating: "cd", count: 32), target = String(repeating: "ef", count: 32)
    let operations: [ChromatographBackend.Operation] = [
      .blend(.init(chunk: .init(x: 12, y: -5), parent: parent, compositeOp: .destinationOut, blendMode: .multiply, opacity: 128, payloadHash: payload)),
      .undo(.init(targetPatchHash: target)),
    ]
    let values = try OperationPacketCodec.values(operations)
    #expect(try OperationPacketCodec.decodeValues(values) == operations)
    let encoded = try CBOREncoder().encode(.array(values))
    let expected = "8288005820" + parent + "0c24010118805820" + payload + "82015820" + target
    #expect(encoded.cborHex == expected)
  }

  @Test func rejectsInvalidHash() {
    #expect(throws: OperationPacketCodecError.invalidHash("bad")) {
      try OperationPacketCodec.values([.undo(.init(targetPatchHash: "bad"))])
    }
  }
}
