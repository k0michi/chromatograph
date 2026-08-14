import Foundation

enum PNGValidationError: Error, Equatable {
    case invalidDimensions(width: Int, height: Int)
    case invalidFormat
}

enum PNGValidator {
    static func validateRGBA8(_ data: Data, width: Int, height: Int) throws {
        let decoded = try PNGCodec.decode(data)
        guard decoded.width == width, decoded.height == height else {
            throw PNGValidationError.invalidDimensions(width: decoded.width, height: decoded.height)
        }
        guard decoded.isRGBA8 else {
            throw PNGValidationError.invalidFormat
        }
    }
}
