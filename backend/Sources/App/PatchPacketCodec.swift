import Foundation

enum PatchPacketCodecError: Error, Equatable {
    case invalidFormatVersion(UInt32)
    case invalidPublicKey(String)
    case invalidHash(String)
    case invalidSignature(String)
    case packetTooLarge
    case truncatedPacket
    case trailingBytes(Int)
}

enum PatchPacketCodec {
    private static let publicKeyByteCount = 32
    private static let hashByteCount = 32
    private static let signatureByteCount = 64

    static func encode(_ patch: Patch) throws -> Data {
        let operations = try OperationPacketCodec.encode(patch.operations)
        guard let operationsByteCount = UInt32(exactly: operations.count) else {
            throw PatchPacketCodecError.packetTooLarge
        }
        let publicKey = try fixedHex(
            patch.publicKeyHex,
            byteCount: publicKeyByteCount,
            error: .invalidPublicKey(patch.publicKeyHex)
        )
        let hash = try fixedHex(
            patch.hash,
            byteCount: hashByteCount,
            error: .invalidHash(patch.hash)
        )
        let signature = try fixedHex(
            patch.signatureHex,
            byteCount: signatureByteCount,
            error: .invalidSignature(patch.signatureHex)
        )

        var writer = PatchPacketWriter()
        writer.append(packetVersion)
        writer.append(operationsByteCount)
        writer.append(operations)
        writer.append(publicKey)
        writer.append(hash)
        writer.append(signature)
        return writer.data
    }

    static func decode(_ data: Data) throws -> Patch {
        var reader = PatchPacketReader(data: data)
        let version = try reader.readUInt32()
        guard version == packetVersion else {
            throw PatchPacketCodecError.invalidFormatVersion(version)
        }
        let operationsByteCount = try reader.readCount()
        let operations = try OperationPacketCodec.decode(reader.readData(count: operationsByteCount))
        let publicKeyHex = try reader.readData(count: publicKeyByteCount).patchHexString
        let hash = try reader.readData(count: hashByteCount).patchHexString
        let signatureHex = try reader.readData(count: signatureByteCount).patchHexString
        guard reader.remainingByteCount == 0 else {
            throw PatchPacketCodecError.trailingBytes(reader.remainingByteCount)
        }
        return Patch(
            operations: operations,
            publicKeyHex: publicKeyHex,
            hash: hash,
            signatureHex: signatureHex
        )
    }

    private static func fixedHex(
        _ value: String,
        byteCount: Int,
        error: PatchPacketCodecError
    ) throws -> Data {
        guard let data = Data(patchHexString: value), data.count == byteCount else {
            throw error
        }
        return data
    }
}

private struct PatchPacketWriter {
    var data = Data()

    mutating func append(_ value: UInt32) {
        var bigEndian = value.bigEndian
        withUnsafeBytes(of: &bigEndian) { data.append(contentsOf: $0) }
    }

    mutating func append(_ bytes: Data) {
        data.append(bytes)
    }
}

private struct PatchPacketReader {
    let data: Data
    private(set) var offset = 0

    var remainingByteCount: Int { data.count - offset }

    mutating func readUInt32() throws -> UInt32 {
        let bytes = try readData(count: 4)
        return bytes.reduce(0) { ($0 << 8) | UInt32($1) }
    }

    mutating func readCount() throws -> Int {
        guard let count = Int(exactly: try readUInt32()) else {
            throw PatchPacketCodecError.packetTooLarge
        }
        return count
    }

    mutating func readData(count: Int) throws -> Data {
        guard count >= 0, count <= remainingByteCount else {
            throw PatchPacketCodecError.truncatedPacket
        }
        let start = offset
        offset += count
        return data.subdata(in: start..<offset)
    }
}

private extension Data {
    init?(patchHexString: String) {
        guard patchHexString.count.isMultiple(of: 2) else { return nil }
        var bytes: [UInt8] = []
        bytes.reserveCapacity(patchHexString.count / 2)
        var index = patchHexString.startIndex
        while index < patchHexString.endIndex {
            let next = patchHexString.index(index, offsetBy: 2)
            guard let byte = UInt8(patchHexString[index..<next], radix: 16) else { return nil }
            bytes.append(byte)
            index = next
        }
        self.init(bytes)
    }

    var patchHexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
