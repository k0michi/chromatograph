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
        return Array(bytes[position ..< position + count])
    }
}
