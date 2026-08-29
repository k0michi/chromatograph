import Foundation

/// A value in the RFC 8949 generic data model.
public indirect enum CBORValue: Equatable, Sendable {
    /// Major type 0.
    case unsignedInteger(UInt64)
    /// Major type 1. The stored argument represents the value `-1 - argument`.
    case negativeInteger(UInt64)
    case byteString(Data)
    case textString(String)
    case array([CBORValue])
    case map([CBORMapEntry])
    case tagged(UInt64, CBORValue)
    case simple(UInt8)
    case boolean(Bool)
    case null
    case undefined
    case floatingPoint(Double)

    public static func integer(_ value: Int64) -> CBORValue {
        value >= 0
            ? .unsignedInteger(UInt64(value))
            : .negativeInteger(UInt64(bitPattern: -(value + 1)))
    }
}

public struct CBORMapEntry: Equatable, Sendable {
    public let key: CBORValue
    public let value: CBORValue

    public init(key: CBORValue, value: CBORValue) {
        self.key = key
        self.value = value
    }
}
