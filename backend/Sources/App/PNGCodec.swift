import Foundation
import PNG

struct DecodedPNG: Sendable {
  let width: Int
  let height: Int
  let format: PNG.Format
  let rgba: [UInt8]
}

enum PNGCodec {
  static func decode(_ data: Data) throws -> DecodedPNG {
    var source = PNGMemorySource(Array(data))
    let image = try PNG.Image.decompress(stream: &source)
    let rgba = image.unpack(as: PNG.RGBA<UInt8>.self).flatMap { [$0.r, $0.g, $0.b, $0.a] }
    return DecodedPNG(
      width: image.size.x,
      height: image.size.y,
      format: image.layout.format,
      rgba: rgba
    )
  }

  static func encodeRGBA8(_ rgba: [UInt8], width: Int, height: Int) throws -> Data {
    let expectedCount = width * height * 4
    guard width > 0, height > 0, rgba.count == expectedCount else {
      throw PNGCodecError.invalidRGBAByteCount(rgba.count)
    }
    let pixels = stride(from: 0, to: rgba.count, by: 4).map {
      PNG.RGBA<UInt8>(rgba[$0], rgba[$0 + 1], rgba[$0 + 2], rgba[$0 + 3])
    }
    let image = PNG.Image(
      packing: pixels,
      size: (x: width, y: height),
      layout: .init(format: .rgba8(palette: [], fill: nil))
    )
    var destination = PNGMemoryDestination()
    try image.compress(stream: &destination, level: 3)
    return Data(destination.bytes)
  }
}

enum PNGCodecError: Error, Equatable {
  case invalidRGBAByteCount(Int)
}

private struct PNGMemorySource: PNG.BytestreamSource {
  private let bytes: [UInt8]
  private var position = 0

  init(_ bytes: [UInt8]) {
    self.bytes = bytes
  }

  mutating func read(count: Int) -> [UInt8]? {
    guard count >= 0, position <= bytes.count - count else { return nil }
    defer { position += count }
    return Array(bytes[position..<position + count])
  }
}

private struct PNGMemoryDestination: PNG.BytestreamDestination {
  var bytes: [UInt8] = []

  mutating func write(_ bytes: [UInt8]) -> Void? {
    self.bytes.append(contentsOf: bytes)
    return ()
  }
}
