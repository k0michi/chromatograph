import Foundation
import PNG

enum PNGValidationError: Error, Equatable {
    case invalidDimensions(width: Int, height: Int)
    case invalidFormat
}

enum PNGValidator {
    static func validateRGBA8(_ data: Data, width: Int, height: Int) throws {
        var source = PNGMemorySource(Array(data))
        let image = try PNG.Image.decompress(stream: &source)
        guard image.size.x == width, image.size.y == height else {
            throw PNGValidationError.invalidDimensions(width: image.size.x, height: image.size.y)
        }
        guard case .rgba8 = image.layout.format else {
            throw PNGValidationError.invalidFormat
        }
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
