import CBOR
import Foundation

enum OperationPacketCodecError: Error, Equatable {
  case invalidFormat
  case invalidOperationType(UInt64)
  case invalidCompositeOp(UInt64)
  case invalidBlendMode(UInt64)
  case invalidHash(String)
  case truncatedPacket
  case trailingBytes(Int)
}

enum OperationPacketCodec {
  static let formatVersion: UInt64 = 0

  static func payloadValue(operations: [Operation], publicKeyHex: String, timestamp: UInt64) throws -> CBORValue {
    guard let publicKey = Data(cborHex: publicKeyHex), publicKey.count == 32 else {
      throw OperationPacketCodecError.invalidHash(publicKeyHex)
    }
    return .array([.unsignedInteger(formatVersion), .byteString(publicKey), .unsignedInteger(timestamp), .array(try values(operations))])
  }

  static func encodePayload(operations: [Operation], publicKeyHex: String, timestamp: UInt64) throws -> Data {
    try CBOREncoder().encode(payloadValue(operations: operations, publicKeyHex: publicKeyHex, timestamp: timestamp))
  }

  static func values(_ operations: [Operation]) throws -> [CBORValue] {
    try operations.map { operation in
      switch operation {
      case .blend(let blend):
        return .array([
          .unsignedInteger(0), try hash(blend.parent), integer(blend.chunk.x), integer(blend.chunk.y),
          .unsignedInteger(UInt64(blend.compositeOp.rawValue)), .unsignedInteger(UInt64(blend.blendMode.rawValue)),
          .unsignedInteger(UInt64(blend.opacity)), try hash(blend.payloadHash),
        ])
      case .undo(let undo):
        return .array([.unsignedInteger(1), try hash(undo.targetPatchHash)])
      }
    }
  }

  static func decodeValues(_ values: [CBORValue]) throws -> [Operation] {
    try values.map { value in
      guard case .array(let fields) = value, let type = fields.first?.uint else { throw OperationPacketCodecError.invalidFormat }
      if type == 1 {
        guard fields.count == 2, let target = fields[1].hashHex else { throw OperationPacketCodecError.invalidFormat }
        return .undo(UndoOperation(targetPatchHash: target))
      }
      guard type == 0 else { throw OperationPacketCodecError.invalidOperationType(type) }
      guard fields.count == 8, let parent = fields[1].hashHex, let x = fields[2].int32, let y = fields[3].int32,
            let compositeRaw = fields[4].uint, compositeRaw <= UInt64(UInt32.max),
            let composite = CompositeOp(rawValue: UInt32(compositeRaw)),
            let blendRaw = fields[5].uint, blendRaw <= UInt64(UInt32.max),
            let blend = BlendMode(rawValue: UInt32(blendRaw)),
            let opacity = fields[6].uint, opacity <= 255, let payloadHash = fields[7].hashHex
      else { throw OperationPacketCodecError.invalidFormat }
      return .blend(BlendOperation(chunk: .init(x: x, y: y), parent: parent, compositeOp: composite, blendMode: blend, opacity: UInt8(opacity), payloadHash: payloadHash))
    }
  }

  private static func hash(_ value: String) throws -> CBORValue {
    guard let bytes = Data(cborHex: value), bytes.count == 32 else { throw OperationPacketCodecError.invalidHash(value) }
    return .byteString(bytes)
  }

  private static func integer(_ value: Int32) -> CBORValue {
    value >= 0 ? .unsignedInteger(UInt64(value)) : .negativeInteger(UInt64(-1 - Int64(value)))
  }
}

extension CBORValue {
  var uint: UInt64? { guard case .unsignedInteger(let value) = self else { return nil }; return value }
  var int32: Int32? {
    switch self {
    case .unsignedInteger(let value) where value <= UInt64(Int32.max): return Int32(value)
    case .negativeInteger(let value) where value <= UInt64(Int32.max): return Int32(-1 - Int64(value))
    default: return nil
    }
  }
  var hashHex: String? { guard case .byteString(let data) = self, data.count == 32 else { return nil }; return data.cborHex }
}

extension Data {
  init?(cborHex string: String) {
    guard string.count.isMultiple(of: 2) else { return nil }
    var result = Data(capacity: string.count / 2); var index = string.startIndex
    while index < string.endIndex { let end = string.index(index, offsetBy: 2); guard let byte = UInt8(string[index..<end], radix: 16) else { return nil }; result.append(byte); index = end }
    self = result
  }
  var cborHex: String { map { String(format: "%02x", $0) }.joined() }
}
