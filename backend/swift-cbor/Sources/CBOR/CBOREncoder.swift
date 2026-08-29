import Foundation

public enum CBOREncodingError: Error, Equatable, Sendable {
    case invalidSimpleValue(UInt8)
    case duplicateMapKey
}

/// Encodes RFC 8949 values using the core deterministic rules in section 4.2.1.
public struct CBOREncoder: Sendable {
    public init() {}

    public func encode(_ value: CBORValue) throws -> Data {
        var output = Data()
        try append(value, to: &output)
        return output
    }

    private func append(_ value: CBORValue, to output: inout Data) throws {
        switch value {
        case .unsignedInteger(let value):
            appendHead(majorType: 0, argument: value, to: &output)
        case .negativeInteger(let argument):
            appendHead(majorType: 1, argument: argument, to: &output)
        case .byteString(let bytes):
            appendHead(majorType: 2, argument: UInt64(bytes.count), to: &output)
            output.append(bytes)
        case .textString(let string):
            let bytes = Data(string.utf8)
            appendHead(majorType: 3, argument: UInt64(bytes.count), to: &output)
            output.append(bytes)
        case .array(let values):
            appendHead(majorType: 4, argument: UInt64(values.count), to: &output)
            for value in values { try append(value, to: &output) }
        case .map(let entries):
            let encoded = try entries.map { entry in
                (key: try encode(entry.key), value: entry.value)
            }.sorted { lexicographicallyPrecedes($0.key, $1.key) }
            if encoded.count > 1 {
                for index in 1..<encoded.count where encoded[index - 1].key == encoded[index].key {
                    throw CBOREncodingError.duplicateMapKey
                }
            }
            appendHead(majorType: 5, argument: UInt64(encoded.count), to: &output)
            for entry in encoded {
                output.append(entry.key)
                try append(entry.value, to: &output)
            }
        case .tagged(let tag, let content):
            appendHead(majorType: 6, argument: tag, to: &output)
            try append(content, to: &output)
        case .simple(let value):
            guard value != 20, value != 21, value != 22, value != 23 else {
                throw CBOREncodingError.invalidSimpleValue(value)
            }
            if value < 24 {
                output.append(0xe0 | value)
            } else {
                output.append(0xf8)
                output.append(value)
            }
        case .boolean(let value):
            output.append(value ? 0xf5 : 0xf4)
        case .null:
            output.append(0xf6)
        case .undefined:
            output.append(0xf7)
        case .floatingPoint(let value):
            appendFloatingPoint(value, to: &output)
        }
    }

    private func appendHead(majorType: UInt8, argument: UInt64, to output: inout Data) {
        let initial = majorType << 5
        switch argument {
        case 0..<24:
            output.append(initial | UInt8(argument))
        case 24...UInt64(UInt8.max):
            output.append(initial | 24)
            output.append(UInt8(argument))
        case 0x100...UInt64(UInt16.max):
            output.append(initial | 25)
            appendBigEndian(argument, byteCount: 2, to: &output)
        case 0x1_0000...UInt64(UInt32.max):
            output.append(initial | 26)
            appendBigEndian(argument, byteCount: 4, to: &output)
        default:
            output.append(initial | 27)
            appendBigEndian(argument, byteCount: 8, to: &output)
        }
    }

    private func appendFloatingPoint(_ value: Double, to output: inout Data) {
        if value.isNaN {
            output.append(contentsOf: [0xf9, 0x7e, 0x00])
            return
        }
        let half = Float16(value)
        if exactlyEqual(value, Double(half)) {
            output.append(0xf9)
            appendBigEndian(UInt64(half.bitPattern), byteCount: 2, to: &output)
            return
        }
        let single = Float(value)
        if exactlyEqual(value, Double(single)) {
            output.append(0xfa)
            appendBigEndian(UInt64(single.bitPattern), byteCount: 4, to: &output)
            return
        }
        output.append(0xfb)
        appendBigEndian(value.bitPattern, byteCount: 8, to: &output)
    }

    private func exactlyEqual(_ lhs: Double, _ rhs: Double) -> Bool {
        lhs == rhs && (lhs != 0 || lhs.sign == rhs.sign)
    }

    private func appendBigEndian(_ value: UInt64, byteCount: Int, to output: inout Data) {
        for shift in stride(from: (byteCount - 1) * 8, through: 0, by: -8) {
            output.append(UInt8(truncatingIfNeeded: value >> UInt64(shift)))
        }
    }
}

private func lexicographicallyPrecedes(_ lhs: Data, _ rhs: Data) -> Bool {
    lhs.lexicographicallyPrecedes(rhs)
}
