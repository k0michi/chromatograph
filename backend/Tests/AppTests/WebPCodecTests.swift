import Foundation
import Testing
import WebP

@testable import ChromatographBackend

@Suite
struct WebPCodecTests {
    @Test
    func losslessRGBAEncodeDecodeRoundTrip() throws {
        let width = 3
        let height = 2
        let rgba = Data([
            255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 64,
            255, 255, 255, 255, 0, 0, 0, 0, 10, 20, 30, 40,
        ])

        let encoded = try WebPCodec.encodeRGBA(rgba, width: width, height: height)
        let features = try WebPImageInspector.inspect(encoded)
        let decoded = try WebPCodec.decodeRGBA(encoded)

        #expect(features.width == width)
        #expect(features.height == height)
        #expect(decoded == DecodedWebP(width: width, height: height, rgba: rgba))
    }

    @Test
    func rejectsMismatchedRGBAByteCount() {
        #expect(throws: WebPCodecError.invalidRGBAByteCount(expected: 16, actual: 3)) {
            try WebPCodec.encodeRGBA(Data([0, 1, 2]), width: 2, height: 2)
        }
    }

    @Test
    func rejectsInvalidDimensions() {
        #expect(throws: WebPCodecError.invalidDimensions(width: 0, height: 1)) {
            try WebPCodec.encodeRGBA(Data(), width: 0, height: 1)
        }
    }
}
