import Foundation

public struct CBORDecodingOptions: Sendable {
    public var requireDeterministicEncoding: Bool
    public var maximumNestingDepth: Int
    public var maximumCollectionCount: Int
    public var maximumStringByteCount: Int

    public init(
        requireDeterministicEncoding: Bool = true,
        maximumNestingDepth: Int = 64,
        maximumCollectionCount: Int = 1_000_000,
        maximumStringByteCount: Int = 64 * 1024 * 1024
    ) {
        self.requireDeterministicEncoding = requireDeterministicEncoding
        self.maximumNestingDepth = maximumNestingDepth
        self.maximumCollectionCount = maximumCollectionCount
        self.maximumStringByteCount = maximumStringByteCount
    }
}

public enum CBORDecodingError: Error, Equatable, Sendable {
    case truncated(offset: Int)
    case trailingBytes(offset: Int)
    case reservedAdditionalInformation(UInt8, offset: Int)
    case invalidIndefiniteLength(majorType: UInt8, offset: Int)
    case unexpectedBreak(offset: Int)
    case invalidUTF8(offset: Int)
    case invalidChunkType(expected: UInt8, offset: Int)
    case oddIndefiniteMap(offset: Int)
    case nonPreferredEncoding(offset: Int)
    case unsortedMapKeys(offset: Int)
    case duplicateMapKey(offset: Int)
    case nestingTooDeep(offset: Int)
    case collectionTooLarge(offset: Int)
    case stringTooLarge(offset: Int)
    case lengthOverflow(offset: Int)
}

public struct CBORDecoder: Sendable {
    public let options: CBORDecodingOptions

    public init(options: CBORDecodingOptions = .init()) {
        self.options = options
    }

    public func decode(_ data: Data) throws -> CBORValue {
        var reader = Reader(data: data, options: options)
        let value = try reader.readValue(depth: 0)
        guard reader.isAtEnd else { throw CBORDecodingError.trailingBytes(offset: reader.offset) }
        return value
    }
}

private struct Reader {
    let data: Data
    let options: CBORDecodingOptions
    private(set) var offset = 0

    var isAtEnd: Bool { offset == data.count }

    mutating func readValue(depth: Int) throws -> CBORValue {
        guard depth <= options.maximumNestingDepth else {
            throw CBORDecodingError.nestingTooDeep(offset: offset)
        }
        let itemOffset = offset
        let initial = try readByte()
        if initial == 0xff { throw CBORDecodingError.unexpectedBreak(offset: itemOffset) }
        let majorType = initial >> 5
        let additional = initial & 0x1f
        if additional >= 28 && additional <= 30 {
            throw CBORDecodingError.reservedAdditionalInformation(additional, offset: itemOffset)
        }
        if additional == 31 {
            guard !options.requireDeterministicEncoding else {
                throw CBORDecodingError.nonPreferredEncoding(offset: itemOffset)
            }
            return try readIndefinite(majorType: majorType, depth: depth, itemOffset: itemOffset)
        }

        if majorType == 7 { return try readSimpleOrFloat(additional: additional, itemOffset: itemOffset) }
        let argument = try readArgument(additional: additional, itemOffset: itemOffset)
        switch majorType {
        case 0: return .unsignedInteger(argument)
        case 1: return .negativeInteger(argument)
        case 2: return .byteString(try readStringBytes(count: argument, itemOffset: itemOffset))
        case 3:
            let bytes = try readStringBytes(count: argument, itemOffset: itemOffset)
            guard let string = String(data: bytes, encoding: .utf8) else {
                throw CBORDecodingError.invalidUTF8(offset: itemOffset)
            }
            return .textString(string)
        case 4:
            return .array(try readArray(count: argument, depth: depth, itemOffset: itemOffset))
        case 5:
            return .map(try readMap(count: argument, depth: depth, itemOffset: itemOffset))
        case 6:
            return .tagged(argument, try readValue(depth: depth + 1))
        default:
            preconditionFailure("All major types are handled")
        }
    }

    private mutating func readArgument(additional: UInt8, itemOffset: Int) throws -> UInt64 {
        let argument: UInt64
        switch additional {
        case 0..<24: argument = UInt64(additional)
        case 24: argument = try readUInt(byteCount: 1)
        case 25: argument = try readUInt(byteCount: 2)
        case 26: argument = try readUInt(byteCount: 4)
        case 27: argument = try readUInt(byteCount: 8)
        default: preconditionFailure("Additional information was validated")
        }
        if options.requireDeterministicEncoding {
            let preferred = argument < 24 ? UInt8(argument)
                : argument <= UInt8.max ? 24
                : argument <= UInt16.max ? 25
                : argument <= UInt32.max ? 26 : 27
            if additional != preferred {
                throw CBORDecodingError.nonPreferredEncoding(offset: itemOffset)
            }
        }
        return argument
    }

    private mutating func readSimpleOrFloat(additional: UInt8, itemOffset: Int) throws -> CBORValue {
        switch additional {
        case 0...19: return .simple(additional)
        case 20: return .boolean(false)
        case 21: return .boolean(true)
        case 22: return .null
        case 23: return .undefined
        case 24:
            let value = try readByte()
            if options.requireDeterministicEncoding && value < 24 {
                throw CBORDecodingError.nonPreferredEncoding(offset: itemOffset)
            }
            return .simple(value)
        case 25:
            let bits = UInt16(try readUInt(byteCount: 2))
            let value = Double(Float16(bitPattern: bits))
            if options.requireDeterministicEncoding && value.isNaN && bits != 0x7e00 {
                throw CBORDecodingError.nonPreferredEncoding(offset: itemOffset)
            }
            return .floatingPoint(value)
        case 26:
            let bits = UInt32(try readUInt(byteCount: 4))
            let value = Double(Float(bitPattern: bits))
            if options.requireDeterministicEncoding && isRepresentableAsHalf(value) {
                throw CBORDecodingError.nonPreferredEncoding(offset: itemOffset)
            }
            return .floatingPoint(value)
        case 27:
            let value = Double(bitPattern: try readUInt(byteCount: 8))
            if options.requireDeterministicEncoding && isRepresentableAsFloat(value) {
                throw CBORDecodingError.nonPreferredEncoding(offset: itemOffset)
            }
            return .floatingPoint(value)
        default:
            preconditionFailure("Reserved values and break were handled")
        }
    }

    private func isRepresentableAsHalf(_ value: Double) -> Bool {
        if value.isNaN { return true }
        let converted = Double(Float16(value))
        return value == converted && (value != 0 || value.sign == converted.sign)
    }

    private func isRepresentableAsFloat(_ value: Double) -> Bool {
        if value.isNaN { return true }
        let converted = Double(Float(value))
        return value == converted && (value != 0 || value.sign == converted.sign)
    }

    private mutating func readArray(count: UInt64, depth: Int, itemOffset: Int) throws -> [CBORValue] {
        let count = try checkedCollectionCount(count, itemOffset: itemOffset)
        var values: [CBORValue] = []
        values.reserveCapacity(count)
        for _ in 0..<count { values.append(try readValue(depth: depth + 1)) }
        return values
    }

    private mutating func readMap(count: UInt64, depth: Int, itemOffset: Int) throws -> [CBORMapEntry] {
        let count = try checkedCollectionCount(count, itemOffset: itemOffset)
        var entries: [CBORMapEntry] = []
        entries.reserveCapacity(count)
        var encodedKeys = Set<Data>()
        var previousKey: Data?
        for _ in 0..<count {
            let keyOffset = offset
            let key = try readValue(depth: depth + 1)
            let encodedKey = data.subdata(in: keyOffset..<offset)
            let identity = (try? CBOREncoder().encode(key)) ?? encodedKey
            guard encodedKeys.insert(identity).inserted else {
                throw CBORDecodingError.duplicateMapKey(offset: keyOffset)
            }
            if options.requireDeterministicEncoding, let previousKey,
                !previousKey.lexicographicallyPrecedes(encodedKey) {
                throw CBORDecodingError.unsortedMapKeys(offset: keyOffset)
            }
            previousKey = encodedKey
            entries.append(CBORMapEntry(key: key, value: try readValue(depth: depth + 1)))
        }
        return entries
    }

    private mutating func readIndefinite(
        majorType: UInt8,
        depth: Int,
        itemOffset: Int
    ) throws -> CBORValue {
        guard majorType >= 2 && majorType <= 5 else {
            throw CBORDecodingError.invalidIndefiniteLength(majorType: majorType, offset: itemOffset)
        }
        switch majorType {
        case 2:
            var result = Data()
            while try !consumeBreak() {
                let chunkOffset = offset
                try requireDefiniteChunk(majorType: 2, offset: chunkOffset)
                guard case .byteString(let chunk) = try readValue(depth: depth + 1) else {
                    throw CBORDecodingError.invalidChunkType(expected: 2, offset: chunkOffset)
                }
                guard result.count <= options.maximumStringByteCount - chunk.count else {
                    throw CBORDecodingError.stringTooLarge(offset: itemOffset)
                }
                result.append(chunk)
            }
            return .byteString(result)
        case 3:
            var result = ""
            var byteCount = 0
            while try !consumeBreak() {
                let chunkOffset = offset
                try requireDefiniteChunk(majorType: 3, offset: chunkOffset)
                guard case .textString(let chunk) = try readValue(depth: depth + 1) else {
                    throw CBORDecodingError.invalidChunkType(expected: 3, offset: chunkOffset)
                }
                byteCount += chunk.utf8.count
                guard byteCount <= options.maximumStringByteCount else {
                    throw CBORDecodingError.stringTooLarge(offset: itemOffset)
                }
                result += chunk
            }
            return .textString(result)
        case 4:
            var values: [CBORValue] = []
            while try !consumeBreak() {
                guard values.count < options.maximumCollectionCount else {
                    throw CBORDecodingError.collectionTooLarge(offset: itemOffset)
                }
                values.append(try readValue(depth: depth + 1))
            }
            return .array(values)
        case 5:
            var entries: [CBORMapEntry] = []
            var keys = Set<Data>()
            while try !consumeBreak() {
                guard entries.count < options.maximumCollectionCount else {
                    throw CBORDecodingError.collectionTooLarge(offset: itemOffset)
                }
                let keyOffset = offset
                let key = try readValue(depth: depth + 1)
                if try consumeBreak() { throw CBORDecodingError.oddIndefiniteMap(offset: offset - 1) }
                let identity = (try? CBOREncoder().encode(key)) ?? data.subdata(in: keyOffset..<offset)
                guard keys.insert(identity).inserted else {
                    throw CBORDecodingError.duplicateMapKey(offset: keyOffset)
                }
                entries.append(CBORMapEntry(key: key, value: try readValue(depth: depth + 1)))
            }
            return .map(entries)
        default: preconditionFailure()
        }
    }

    private mutating func checkedCollectionCount(_ value: UInt64, itemOffset: Int) throws -> Int {
        guard let count = Int(exactly: value) else {
            throw CBORDecodingError.lengthOverflow(offset: itemOffset)
        }
        guard count <= options.maximumCollectionCount else {
            throw CBORDecodingError.collectionTooLarge(offset: itemOffset)
        }
        return count
    }

    private func requireDefiniteChunk(majorType: UInt8, offset: Int) throws {
        guard offset < data.count else { throw CBORDecodingError.truncated(offset: offset) }
        let initial = data[offset]
        guard initial >> 5 == majorType, initial & 0x1f != 31 else {
            throw CBORDecodingError.invalidChunkType(expected: majorType, offset: offset)
        }
    }

    private mutating func readStringBytes(count: UInt64, itemOffset: Int) throws -> Data {
        guard let count = Int(exactly: count) else {
            throw CBORDecodingError.lengthOverflow(offset: itemOffset)
        }
        guard count <= options.maximumStringByteCount else {
            throw CBORDecodingError.stringTooLarge(offset: itemOffset)
        }
        return try readData(count: count)
    }

    private mutating func consumeBreak() throws -> Bool {
        guard offset < data.count else { throw CBORDecodingError.truncated(offset: offset) }
        if data[offset] == 0xff {
            offset += 1
            return true
        }
        return false
    }

    private mutating func readByte() throws -> UInt8 {
        guard offset < data.count else { throw CBORDecodingError.truncated(offset: offset) }
        defer { offset += 1 }
        return data[offset]
    }

    private mutating func readUInt(byteCount: Int) throws -> UInt64 {
        let bytes = try readData(count: byteCount)
        return bytes.reduce(0) { ($0 << 8) | UInt64($1) }
    }

    private mutating func readData(count: Int) throws -> Data {
        guard count >= 0, count <= data.count - offset else {
            throw CBORDecodingError.truncated(offset: offset)
        }
        let range = offset..<(offset + count)
        offset += count
        return data.subdata(in: range)
    }
}
