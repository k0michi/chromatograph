import Crypto
import Foundation

enum PatchValidationError: Error, Equatable {
    case invalidPublicKey
    case invalidHash
    case invalidSignature
}

enum PatchValidator {
    static func validate(_ patch: Patch) throws {
        guard
            let publicKeyData = Data(hexString: patch.publicKeyHex),
            let declaredHash = Data(hexString: patch.hash),
            let signature = Data(hexString: patch.signatureHex)
        else {
            throw PatchValidationError.invalidPublicKey
        }

        let operationBytes = try OperationPacketCodec.encode(patch.operations)
        let computedHash = Data(SHA256.hash(data: operationBytes + publicKeyData))
        guard computedHash == declaredHash else {
            throw PatchValidationError.invalidHash
        }

        let publicKey: Curve25519.Signing.PublicKey
        do {
            publicKey = try .init(rawRepresentation: publicKeyData)
        } catch {
            throw PatchValidationError.invalidPublicKey
        }
        guard publicKey.isValidSignature(signature, for: computedHash) else {
            throw PatchValidationError.invalidSignature
        }
    }
}

private extension Data {
    init?(hexString: String) {
        guard hexString.count.isMultiple(of: 2) else { return nil }
        var result = Data()
        result.reserveCapacity(hexString.count / 2)
        var index = hexString.startIndex
        while index < hexString.endIndex {
            let next = hexString.index(index, offsetBy: 2)
            guard let byte = UInt8(hexString[index..<next], radix: 16) else { return nil }
            result.append(byte)
            index = next
        }
        self = result
    }
}
