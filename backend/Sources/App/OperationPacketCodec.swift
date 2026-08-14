import Foundation

enum OperationPacketCodecError: Error, Equatable {
    case invalidFormatVersion(UInt32)
    case invalidOperationType(UInt32)
    case invalidCompositeOp(UInt32)
    case invalidBlendMode(UInt32)
    case invalidParentHash(String)
    case tooManyElements
    case truncatedPacket
    case trailingBytes(Int)
}

enum OperationPacketCodec {
    private static let blendOperation: UInt32 = 1
    private static let undoOperation: UInt32 = 2
    private static let sha256ByteCount = 32

    static func encode(_ operations: [Operation]) throws -> Data {
        guard let operationCount = UInt32(exactly: operations.count) else {
            throw OperationPacketCodecError.tooManyElements
        }

        var writer = PacketWriter()
        writer.append(packetVersion)
        writer.append(operationCount)

        for operation in operations {
            switch operation {
            case .blend(let operation):
                writer.append(blendOperation)
                try encodeCommon(operation.chunk, parents: operation.parents, into: &writer)
                writer.append(operation.compositeOp.rawValue)
                writer.append(operation.blendMode.rawValue)
                writer.append(operation.opacity.bitPattern)
                guard let imageByteCount = UInt32(exactly: operation.imageBytes.count) else {
                    throw OperationPacketCodecError.tooManyElements
                }
                writer.append(imageByteCount)
                writer.append(operation.imageBytes)

            case .undo(let operation):
                writer.append(undoOperation)
                try encodeCommon(operation.chunk, parents: operation.parents, into: &writer)
            }
        }

        return writer.data
    }

    static func decode(_ data: Data) throws -> [Operation] {
        var reader = PacketReader(data: data)
        let version = try reader.readUInt32()
        guard version == packetVersion else {
            throw OperationPacketCodecError.invalidFormatVersion(version)
        }

        let operationCount = try reader.readCount()
        var operations: [Operation] = []
        operations.reserveCapacity(operationCount)

        for _ in 0..<operationCount {
            let type = try reader.readUInt32()
            let chunk = TileChunk(
                x: Int32(bitPattern: try reader.readUInt32()),
                y: Int32(bitPattern: try reader.readUInt32())
            )
            let parents = try decodeParents(from: &reader)

            switch type {
            case blendOperation:
                let compositeRaw = try reader.readUInt32()
                guard let compositeOp = CompositeOp(rawValue: compositeRaw) else {
                    throw OperationPacketCodecError.invalidCompositeOp(compositeRaw)
                }
                let blendRaw = try reader.readUInt32()
                guard let blendMode = BlendMode(rawValue: blendRaw) else {
                    throw OperationPacketCodecError.invalidBlendMode(blendRaw)
                }
                let opacity = Float(bitPattern: try reader.readUInt32())
                let imageByteCount = try reader.readCount()
                let imageBytes = try reader.readData(count: imageByteCount)
                operations.append(
                    .blend(
                        BlendOperation(
                            chunk: chunk,
                            parents: parents,
                            compositeOp: compositeOp,
                            blendMode: blendMode,
                            opacity: opacity,
                            imageBytes: imageBytes
                        )))

            case undoOperation:
                operations.append(.undo(UndoOperation(chunk: chunk, parents: parents)))

            default:
                throw OperationPacketCodecError.invalidOperationType(type)
            }
        }

        guard reader.remainingByteCount == 0 else {
            throw OperationPacketCodecError.trailingBytes(reader.remainingByteCount)
        }
        return operations
    }

    private static func encodeCommon(
        _ chunk: TileChunk,
        parents: [String],
        into writer: inout PacketWriter
    ) throws {
        writer.append(UInt32(bitPattern: chunk.x))
        writer.append(UInt32(bitPattern: chunk.y))
        guard let parentCount = UInt32(exactly: parents.count) else {
            throw OperationPacketCodecError.tooManyElements
        }
        writer.append(parentCount)
        for parent in parents {
            guard let bytes = Data(hexString: parent), bytes.count == sha256ByteCount else {
                throw OperationPacketCodecError.invalidParentHash(parent)
            }
            writer.append(bytes)
        }
    }

    private static func decodeParents(from reader: inout PacketReader) throws -> [String] {
        let parentCount = try reader.readCount()
        var parents: [String] = []
        parents.reserveCapacity(parentCount)
        for _ in 0..<parentCount {
            parents.append(try reader.readData(count: sha256ByteCount).hexString)
        }
        return parents
    }
}

private struct PacketWriter {
    var data = Data()

    mutating func append(_ value: UInt32) {
        var bigEndian = value.bigEndian
        withUnsafeBytes(of: &bigEndian) { data.append(contentsOf: $0) }
    }

    mutating func append(_ bytes: Data) {
        data.append(bytes)
    }
}

private struct PacketReader {
    let data: Data
    private(set) var offset = 0

    var remainingByteCount: Int { data.count - offset }

    mutating func readUInt32() throws -> UInt32 {
        let bytes = try readData(count: MemoryLayout<UInt32>.size)
        return bytes.reduce(0) { ($0 << 8) | UInt32($1) }
    }

    mutating func readCount() throws -> Int {
        let value = try readUInt32()
        guard let count = Int(exactly: value) else {
            throw OperationPacketCodecError.tooManyElements
        }
        return count
    }

    mutating func readData(count: Int) throws -> Data {
        guard count >= 0, count <= remainingByteCount else {
            throw OperationPacketCodecError.truncatedPacket
        }
        let start = offset
        offset += count
        return data.subdata(in: start..<offset)
    }
}

extension Data {
    fileprivate init?(hexString: String) {
        guard hexString.count.isMultiple(of: 2) else { return nil }
        var bytes: [UInt8] = []
        bytes.reserveCapacity(hexString.count / 2)
        var index = hexString.startIndex
        while index < hexString.endIndex {
            let next = hexString.index(index, offsetBy: 2)
            guard let byte = UInt8(hexString[index..<next], radix: 16) else { return nil }
            bytes.append(byte)
            index = next
        }
        self.init(bytes)
    }

    fileprivate var hexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
