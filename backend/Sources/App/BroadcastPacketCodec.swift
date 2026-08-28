import Foundation

enum BroadcastPacketCodec {
  enum Kind: UInt32 {
    case patch = 1
    case snapshots = 2
    case patchAcknowledgement = 3
  }

  static func encode(kind: Kind, payload: Data) -> Data {
    var kind = kind.rawValue.bigEndian
    var packet = Data()
    withUnsafeBytes(of: &kind) { packet.append(contentsOf: $0) }
    packet.append(payload)
    return packet
  }

  static func encodePatchAcknowledgement(hash: String) -> Data {
    encode(kind: .patchAcknowledgement, payload: Data(hash.utf8))
  }
}
