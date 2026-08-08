import Foundation
import WebP

struct DecodedWebP: Equatable, Sendable {
    let width: Int
    let height: Int
    let rgba: Data
}

enum WebPCodecError: Error, Equatable {
    case invalidDimensions(width: Int, height: Int)
    case invalidRGBAByteCount(expected: Int, actual: Int)
    case animatedImageUnsupported
}

enum WebPCodec {
    static func encodeRGBA(
        _ rgba: Data,
        width: Int,
        height: Int,
        lossless: Bool = true,
        quality: Float = 90
    ) throws -> Data {
        let expectedByteCount = try rgbaByteCount(width: width, height: height)
        guard rgba.count == expectedByteCount else {
            throw WebPCodecError.invalidRGBAByteCount(
                expected: expectedByteCount,
                actual: rgba.count
            )
        }

        let config = if lossless {
            try WebPEncoderConfig.losslessPreset(level: 6)
        } else {
            WebPEncoderConfig.preset(.picture, quality: quality)
        }
        return try rgba.withUnsafeBytes { rawBuffer in
            try WebPEncoder().encode(
                rawBuffer.bindMemory(to: UInt8.self),
                format: .rgba,
                config: config,
                originWidth: width,
                originHeight: height,
                stride: width * 4
            )
        }
    }

    static func decodeRGBA(_ webPData: Data) throws -> DecodedWebP {
        let features = try WebPImageInspector.inspect(webPData)
        guard !features.hasAnimation else {
            throw WebPCodecError.animatedImageUnsupported
        }
        let rgba = try WebPDecoder().decode(
            webPData,
            options: WebPDecoderOptions(),
            format: .rgba
        )
        return DecodedWebP(width: features.width, height: features.height, rgba: rgba)
    }

    private static func rgbaByteCount(width: Int, height: Int) throws -> Int {
        guard width > 0, height > 0 else {
            throw WebPCodecError.invalidDimensions(width: width, height: height)
        }
        let pixelCount = width.multipliedReportingOverflow(by: height)
        guard !pixelCount.overflow else {
            throw WebPCodecError.invalidDimensions(width: width, height: height)
        }
        let byteCount = pixelCount.partialValue.multipliedReportingOverflow(by: 4)
        guard !byteCount.overflow else {
            throw WebPCodecError.invalidDimensions(width: width, height: height)
        }
        return byteCount.partialValue
    }
}
