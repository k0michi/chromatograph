import Crypto
import Foundation
import Testing

@testable import ChromatographBackend

@Suite
struct PatchValidatorTests {
    @Test
    func acceptsValidHashAndSignature() throws {
        let patch = try signedPatch()
        try PatchValidator.validate(patch)
    }

    @Test
    func rejectsModifiedHash() throws {
        let patch = try signedPatch()
        let modified = Patch(
            operations: patch.operations,
            publicKeyHex: patch.publicKeyHex,
            hash: String(repeating: "00", count: 32),
            signatureHex: patch.signatureHex
        )
        #expect(throws: PatchValidationError.invalidHash) {
            try PatchValidator.validate(modified)
        }
    }

    @Test
    func rejectsModifiedSignature() throws {
        let patch = try signedPatch()
        let modified = Patch(
            operations: patch.operations,
            publicKeyHex: patch.publicKeyHex,
            hash: patch.hash,
            signatureHex: String(repeating: "00", count: 64)
        )
        #expect(throws: PatchValidationError.invalidSignature) {
            try PatchValidator.validate(modified)
        }
    }
}

private func signedPatch() throws -> Patch {
    let operations: [ChromatographBackend.Operation] = [
        .undo(.init(chunk: .init(x: 7, y: -3), parents: []))
    ]
    let privateKey = Curve25519.Signing.PrivateKey()
    let publicKey = privateKey.publicKey.rawRepresentation
    let operationBytes = try OperationPacketCodec.encode(operations)
    let hash = Data(SHA256.hash(data: operationBytes + publicKey))
    let signature = try privateKey.signature(for: hash)
    return Patch(
        operations: operations,
        publicKeyHex: publicKey.authHex,
        hash: hash.authHex,
        signatureHex: signature.authHex
    )
}

private extension Data {
    var authHex: String { map { String(format: "%02x", $0) }.joined() }
}
