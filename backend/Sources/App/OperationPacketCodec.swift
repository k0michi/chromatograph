import CBOR
import Foundation

enum OperationPacketCodecError: Error, Equatable {
    case invalidFormat
    case invalidFormatVersion(UInt64)
    case invalidOperationType(UInt64)
    case invalidCompositeOp(UInt64)
    case invalidBlendMode(UInt64)
    case invalidParentHash(String)
    case truncatedPacket
    case trailingBytes(Int)
}

enum OperationPacketCodec {
    private static let blendType: UInt64 = 1
    private static let undoType: UInt64 = 2

    static func encode(_ operations: [Operation]) throws -> Data {
        try CBOREncoder().encode(.array([
            .unsignedInteger(UInt64(packetVersion)),
            .array(try values(operations)),
        ]))
    }

    static func decode(_ data: Data) throws -> [Operation] {
        let root: CBORValue
        do {
            root = try CBORDecoder().decode(data)
        } catch CBORDecodingError.truncated {
            throw OperationPacketCodecError.truncatedPacket
        } catch CBORDecodingError.trailingBytes(let offset) {
            throw OperationPacketCodecError.trailingBytes(data.count - offset)
        } catch {
            throw OperationPacketCodecError.invalidFormat
        }

        guard case .array(let document) = root, document.count == 2,
              case .unsignedInteger(let version) = document[0]
        else { throw OperationPacketCodecError.invalidFormat }
        guard version == UInt64(packetVersion) else {
            throw OperationPacketCodecError.invalidFormatVersion(version)
        }
        guard case .array(let encodedOperations) = document[1] else {
            throw OperationPacketCodecError.invalidFormat
        }
        return try decodeValues(encodedOperations)
    }

    static func values(_ operations: [Operation]) throws -> [CBORValue] {
        try operations.map { operation in
            switch operation {
            case .blend(let blend):
                return .array([
                    .unsignedInteger(blendType),
                    integer(blend.chunk.x),
                    integer(blend.chunk.y),
                    .array(try parents(blend.parents)),
                    .unsignedInteger(UInt64(blend.compositeOp.rawValue)),
                    .unsignedInteger(UInt64(blend.blendMode.rawValue)),
                    .unsignedInteger(UInt64(blend.opacity.bitPattern)),
                    .byteString(blend.imageBytes),
                ])
            case .undo(let undo):
                return .array([
                    .unsignedInteger(undoType),
                    integer(undo.chunk.x),
                    integer(undo.chunk.y),
                    .array(try parents(undo.parents)),
                ])
            }
        }
    }

    static func decodeValues(_ values: [CBORValue]) throws -> [Operation] {
        try values.map { encoded in
            guard case .array(let fields) = encoded,
                  let type = fields.first?.unsignedInteger
            else { throw OperationPacketCodecError.invalidFormat }

            switch type {
            case blendType:
                guard fields.count == 8,
                      let x = fields[1].int32,
                      let y = fields[2].int32,
                      let parents = try? decodeParents(fields[3]),
                      let compositeRaw = fields[4].unsignedInteger,
                      compositeRaw <= UInt64(UInt32.max),
                      let composite = CompositeOp(rawValue: UInt32(compositeRaw)),
                      let blendRaw = fields[5].unsignedInteger,
                      blendRaw <= UInt64(UInt32.max),
                      let blendMode = BlendMode(rawValue: UInt32(blendRaw)),
                      let opacityBits = fields[6].unsignedInteger,
                      opacityBits <= UInt64(UInt32.max),
                      case .byteString(let imageBytes) = fields[7]
                else {
                    if fields.count == 8, let raw = fields[4].unsignedInteger,
                       (raw > UInt64(UInt32.max) || CompositeOp(rawValue: UInt32(raw)) == nil) {
                        throw OperationPacketCodecError.invalidCompositeOp(raw)
                    }
                    if fields.count == 8, let raw = fields[5].unsignedInteger,
                       (raw > UInt64(UInt32.max) || BlendMode(rawValue: UInt32(raw)) == nil) {
                        throw OperationPacketCodecError.invalidBlendMode(raw)
                    }
                    throw OperationPacketCodecError.invalidFormat
                }
                return .blend(BlendOperation(
                    chunk: TileChunk(x: x, y: y),
                    parents: parents,
                    compositeOp: composite,
                    blendMode: blendMode,
                    opacity: Float(bitPattern: UInt32(opacityBits)),
                    imageBytes: imageBytes
                ))
            case undoType:
                guard fields.count == 4,
                      let x = fields[1].int32,
                      let y = fields[2].int32
                else { throw OperationPacketCodecError.invalidFormat }
                return .undo(UndoOperation(
                    chunk: TileChunk(x: x, y: y),
                    parents: try decodeParents(fields[3])
                ))
            default:
                throw OperationPacketCodecError.invalidOperationType(type)
            }
        }
    }

    private static func integer(_ value: Int32) -> CBORValue {
        value >= 0
            ? .unsignedInteger(UInt64(value))
            : .negativeInteger(UInt64(-1 - Int64(value)))
    }

    private static func parents(_ hashes: [String]) throws -> [CBORValue] {
        try hashes.map { hash in
            guard let data = Data(cborHex: hash), data.count == 32 else {
                throw OperationPacketCodecError.invalidParentHash(hash)
            }
            return .byteString(data)
        }
    }

    private static func decodeParents(_ value: CBORValue) throws -> [String] {
        guard case .array(let values) = value else {
            throw OperationPacketCodecError.invalidFormat
        }
        return try values.map {
            guard case .byteString(let data) = $0, data.count == 32 else {
                throw OperationPacketCodecError.invalidFormat
            }
            return data.cborHex
        }
    }
}

extension CBORValue {
    fileprivate var unsignedInteger: UInt64? {
        guard case .unsignedInteger(let value) = self else { return nil }
        return value
    }

    fileprivate var int32: Int32? {
        switch self {
        case .unsignedInteger(let value) where value <= UInt64(Int32.max):
            return Int32(value)
        case .negativeInteger(let argument) where argument <= UInt64(Int32.max):
            return Int32(-1 - Int64(argument))
        default:
            return nil
        }
    }
}

extension Data {
    init?(cborHex string: String) {
        guard string.count.isMultiple(of: 2) else { return nil }
        var result = Data(capacity: string.count / 2)
        var index = string.startIndex
        while index < string.endIndex {
            let end = string.index(index, offsetBy: 2)
            guard let byte = UInt8(string[index..<end], radix: 16) else { return nil }
            result.append(byte)
            index = end
        }
        self = result
    }

    var cborHex: String { map { String(format: "%02x", $0) }.joined() }
}
