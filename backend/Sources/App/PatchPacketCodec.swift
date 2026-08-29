import CBOR
import Foundation

enum PatchPacketCodecError: Error, Equatable {
    case invalidFormat
    case invalidFormatVersion(UInt64)
    case invalidPublicKey(String)
    case invalidHash(String)
    case invalidSignature(String)
    case truncatedPacket
    case trailingBytes(Int)
}

enum PatchPacketCodec {
    static func encode(_ patch: Patch) throws -> Data {
        let publicKey = try fixedBytes(
            patch.publicKeyHex, count: 32,
            error: .invalidPublicKey(patch.publicKeyHex)
        )
        let hash = try fixedBytes(
            patch.hash, count: 32,
            error: .invalidHash(patch.hash)
        )
        let signature = try fixedBytes(
            patch.signatureHex, count: 64,
            error: .invalidSignature(patch.signatureHex)
        )
        return try CBOREncoder().encode(.array([
            .unsignedInteger(UInt64(packetVersion)),
            .array(try OperationPacketCodec.values(patch.operations)),
            .byteString(publicKey),
            .byteString(hash),
            .byteString(signature),
        ]))
    }

    static func decode(_ data: Data) throws -> Patch {
        let root: CBORValue
        do {
            root = try CBORDecoder().decode(data)
        } catch CBORDecodingError.truncated {
            throw PatchPacketCodecError.truncatedPacket
        } catch CBORDecodingError.trailingBytes(let offset) {
            throw PatchPacketCodecError.trailingBytes(data.count - offset)
        } catch {
            throw PatchPacketCodecError.invalidFormat
        }

        guard case .array(let fields) = root, fields.count == 5,
              case .unsignedInteger(let version) = fields[0]
        else { throw PatchPacketCodecError.invalidFormat }
        guard version == UInt64(packetVersion) else {
            throw PatchPacketCodecError.invalidFormatVersion(version)
        }
        guard case .array(let operationValues) = fields[1],
              case .byteString(let publicKey) = fields[2], publicKey.count == 32,
              case .byteString(let hash) = fields[3], hash.count == 32,
              case .byteString(let signature) = fields[4], signature.count == 64
        else { throw PatchPacketCodecError.invalidFormat }

        return Patch(
            operations: try OperationPacketCodec.decodeValues(operationValues),
            publicKeyHex: publicKey.cborHex,
            hash: hash.cborHex,
            signatureHex: signature.cborHex
        )
    }

    private static func fixedBytes(
        _ value: String,
        count: Int,
        error: PatchPacketCodecError
    ) throws -> Data {
        guard let data = Data(cborHex: value), data.count == count else { throw error }
        return data
    }
}
