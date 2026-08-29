import CBOR
import Foundation
import Testing

@Test(arguments: [
    (CBORValue.unsignedInteger(0), "00"),
    (.unsignedInteger(23), "17"),
    (.unsignedInteger(24), "1818"),
    (.unsignedInteger(1_000), "1903e8"),
    (.unsignedInteger(UInt64.max), "1bffffffffffffffff"),
    (.negativeInteger(0), "20"),
    (.negativeInteger(999), "3903e7"),
    (.byteString(Data([1, 2, 3, 4])), "4401020304"),
    (.textString("IETF"), "6449455446"),
    (.textString("水"), "63e6b0b4"),
    (.array([.unsignedInteger(1), .unsignedInteger(2), .unsignedInteger(3)]), "83010203"),
    (.map([]), "a0"),
    (.boolean(false), "f4"),
    (.boolean(true), "f5"),
    (.null, "f6"),
    (.undefined, "f7"),
    (.simple(16), "f0"),
    (.simple(255), "f8ff"),
    (.tagged(1, .unsignedInteger(1_363_896_240)), "c11a514b67b0"),
    (.floatingPoint(0), "f90000"),
    (.floatingPoint(-0.0), "f98000"),
    (.floatingPoint(1.5), "f93e00"),
    (.floatingPoint(100_000), "fa47c35000"),
    (.floatingPoint(1.1), "fb3ff199999999999a"),
    (.floatingPoint(.infinity), "f97c00"),
    (.floatingPoint(-.infinity), "f9fc00"),
])
func appendixAVectors(value: CBORValue, hexadecimal: String) throws {
    let bytes = try CBOREncoder().encode(value)
    #expect(bytes == Data(hexadecimal: hexadecimal))
    #expect(try CBORDecoder().decode(bytes) == value)
}

@Test
func canonicalNaN() throws {
    let bytes = try CBOREncoder().encode(.floatingPoint(.nan))
    #expect(bytes == Data(hexadecimal: "f97e00"))
    guard case .floatingPoint(let decoded) = try CBORDecoder().decode(bytes) else {
        Issue.record("Expected a floating-point value")
        return
    }
    #expect(decoded.isNaN)
}

@Test
func deterministicMapKeyOrdering() throws {
    let value = CBORValue.map([
        .init(key: .boolean(false), value: .null),
        .init(key: .textString("aa"), value: .null),
        .init(key: .negativeInteger(0), value: .null),
        .init(key: .unsignedInteger(100), value: .null),
        .init(key: .textString("z"), value: .null),
        .init(key: .unsignedInteger(10), value: .null),
    ])
    #expect(try CBOREncoder().encode(value) == Data(hexadecimal: "a60af61864f620f6617af6626161f6f4f6"))
}

@Test
func strictDecoderRejectsNonDeterministicRepresentations() {
    #expect(throws: CBORDecodingError.nonPreferredEncoding(offset: 0)) {
        try CBORDecoder().decode(Data(hexadecimal: "1801"))
    }
    #expect(throws: CBORDecodingError.nonPreferredEncoding(offset: 0)) {
        try CBORDecoder().decode(Data(hexadecimal: "9f01ff"))
    }
    #expect(throws: CBORDecodingError.unsortedMapKeys(offset: 4)) {
        try CBORDecoder().decode(Data(hexadecimal: "a2616201616102"))
    }
}

@Test
func variationTolerantDecoderSupportsIndefiniteLengths() throws {
    let decoder = CBORDecoder(options: .init(requireDeterministicEncoding: false))
    #expect(try decoder.decode(Data(hexadecimal: "5f42010243030405ff")) ==
        .byteString(Data([1, 2, 3, 4, 5])))
    #expect(try decoder.decode(Data(hexadecimal: "9f018202039f0405ffff")) == .array([
        .unsignedInteger(1),
        .array([.unsignedInteger(2), .unsignedInteger(3)]),
        .array([.unsignedInteger(4), .unsignedInteger(5)]),
    ]))
    #expect(try decoder.decode(Data(hexadecimal: "f818")) == .simple(24))
    #expect(throws: CBORDecodingError.invalidChunkType(expected: 2, offset: 1)) {
        try decoder.decode(Data(hexadecimal: "5f5f4101ffff"))
    }
}

@Test
func rejectsInvalidInput() {
    #expect(throws: CBORDecodingError.invalidUTF8(offset: 0)) {
        try CBORDecoder().decode(Data(hexadecimal: "62c0ae"))
    }
    #expect(throws: CBORDecodingError.trailingBytes(offset: 1)) {
        try CBORDecoder().decode(Data(hexadecimal: "0001"))
    }
    #expect(throws: CBORDecodingError.truncated(offset: 1)) {
        try CBORDecoder().decode(Data(hexadecimal: "1a01"))
    }
}

private extension Data {
    init(hexadecimal: String) {
        precondition(hexadecimal.count.isMultiple(of: 2))
        var bytes: [UInt8] = []
        var index = hexadecimal.startIndex
        while index < hexadecimal.endIndex {
            let next = hexadecimal.index(index, offsetBy: 2)
            bytes.append(UInt8(hexadecimal[index..<next], radix: 16)!)
            index = next
        }
        self.init(bytes)
    }
}
