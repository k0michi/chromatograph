import Foundation

enum BroadcastPacketCodec {
  enum Kind: UInt32 {
    case patch = 1
    case snapshots = 2
  }

  static func encode(kind: Kind, payload: Data) -> Data {
    var kind = kind.rawValue.bigEndian
    var packet = Data()
    withUnsafeBytes(of: &kind) { packet.append(contentsOf: $0) }
    packet.append(payload)
    return packet
  }
}
