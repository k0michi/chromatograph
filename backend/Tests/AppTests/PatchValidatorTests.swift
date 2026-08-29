import Crypto
import Foundation
import Testing
@testable import ChromatographBackend

@Suite struct PatchValidatorTests {
  @Test func acceptsPayloadSignatureAndImageInvariant() throws { try PatchValidator.validate(signedPatch()) }
  @Test func rejectsModifiedHash() throws {
    let patch = try signedPatch()
    let changed = Patch(operations: patch.operations, publicKeyHex: patch.publicKeyHex, timestamp: patch.timestamp,
      hash: String(repeating: "00", count: 32), signatureHex: patch.signatureHex, images: patch.images)
    #expect(throws: PatchValidationError.invalidHash) { try PatchValidator.validate(changed) }
  }
  @Test func rejectsModifiedSignature() throws {
    let patch = try signedPatch()
    let changed = Patch(operations: patch.operations, publicKeyHex: patch.publicKeyHex, timestamp: patch.timestamp,
      hash: patch.hash, signatureHex: String(repeating: "00", count: 64), images: patch.images)
    #expect(throws: PatchValidationError.invalidSignature) { try PatchValidator.validate(changed) }
  }
}

private func signedPatch() throws -> Patch {
  let privateKey = Curve25519.Signing.PrivateKey(), publicKey = privateKey.publicKey.rawRepresentation
  let operations: [ChromatographBackend.Operation] = [.undo(.init(targetPatchHash: String(repeating: "11", count: 32)))]
  let payload = try OperationPacketCodec.encodePayload(operations: operations, publicKeyHex: publicKey.cborHex, timestamp: 123)
  return Patch(operations: operations, publicKeyHex: publicKey.cborHex, timestamp: 123,
    hash: Data(SHA256.hash(data: payload)).cborHex, signatureHex: try privateKey.signature(for: payload).cborHex, images: [])
}
