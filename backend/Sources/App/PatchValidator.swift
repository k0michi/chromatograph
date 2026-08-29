import Crypto
import Foundation

enum PatchValidationError: Error, Equatable {
  case invalidPublicKey
  case invalidHash
  case invalidSignature
  case invalidImages
}

enum PatchValidator {
  static func validate(_ patch: Patch) throws {
    guard let publicKeyData = Data(cborHex: patch.publicKeyHex), let signature = Data(cborHex: patch.signatureHex) else {
      throw PatchValidationError.invalidPublicKey
    }
    let payload = try OperationPacketCodec.encodePayload(operations: patch.operations, publicKeyHex: patch.publicKeyHex, timestamp: patch.timestamp)
    guard Data(SHA256.hash(data: payload)).cborHex == patch.hash else { throw PatchValidationError.invalidHash }
    let publicKey: Curve25519.Signing.PublicKey
    do { publicKey = try .init(rawRepresentation: publicKeyData) } catch { throw PatchValidationError.invalidPublicKey }
    guard publicKey.isValidSignature(signature, for: payload) else { throw PatchValidationError.invalidSignature }

    let expected = Set(patch.operations.compactMap { operation -> String? in
      guard case .blend(let blend) = operation else { return nil }; return blend.payloadHash
    }).sorted()
    guard expected.count == patch.images.count else { throw PatchValidationError.invalidImages }
    for (hash, image) in zip(expected, patch.images) {
      guard Data(SHA256.hash(data: image)).cborHex == hash else { throw PatchValidationError.invalidImages }
    }
  }
}
