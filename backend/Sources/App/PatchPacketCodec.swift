import CBOR
import Crypto
import Foundation

enum PatchPacketCodecError: Error, Equatable {
  case invalidFormat
  case invalidFormatVersion(UInt64)
  case invalidSignature(String)
  case truncatedPacket
  case trailingBytes(Int)
}

enum PatchPacketCodec {
  static func encode(_ patch: Patch) throws -> Data {
    guard let signature = Data(cborHex: patch.signatureHex), signature.count == 64 else {
      throw PatchPacketCodecError.invalidSignature(patch.signatureHex)
    }
    let payload = try OperationPacketCodec.payloadValue(operations: patch.operations, publicKeyHex: patch.publicKeyHex, timestamp: patch.timestamp)
    return try CBOREncoder().encode(.array([.array([payload, .byteString(signature)]), .array(patch.images.map(CBORValue.byteString))]))
  }

  static func decode(_ data: Data) throws -> Patch {
    let root: CBORValue
    do { root = try CBORDecoder().decode(data) }
    catch CBORDecodingError.truncated { throw PatchPacketCodecError.truncatedPacket }
    catch CBORDecodingError.trailingBytes(let offset) { throw PatchPacketCodecError.trailingBytes(data.count - offset) }
    catch { throw PatchPacketCodecError.invalidFormat }
    guard case .array(let container) = root, container.count == 2,
          case .array(let partial) = container[0], partial.count == 2,
          case .array(let payload) = partial[0], payload.count == 4,
          let version = payload[0].uint else { throw PatchPacketCodecError.invalidFormat }
    guard version == OperationPacketCodec.formatVersion else { throw PatchPacketCodecError.invalidFormatVersion(version) }
    guard case .byteString(let publicKey) = payload[1], publicKey.count == 32,
          let timestamp = payload[2].uint,
          case .array(let operationValues) = payload[3],
          case .byteString(let signature) = partial[1], signature.count == 64,
          case .array(let imageValues) = container[1]
    else { throw PatchPacketCodecError.invalidFormat }
    let images = try imageValues.map { value -> Data in guard case .byteString(let image) = value else { throw PatchPacketCodecError.invalidFormat }; return image }
    let payloadBytes = try CBOREncoder().encode(partial[0])
    return Patch(
      operations: try OperationPacketCodec.decodeValues(operationValues), publicKeyHex: publicKey.cborHex,
      timestamp: timestamp, hash: Data(SHA256.hash(data: payloadBytes)).cborHex,
      signatureHex: signature.cborHex, images: images
    )
  }
}
