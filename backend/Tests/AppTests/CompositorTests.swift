import Testing

@testable import ChromatographBackend

@Suite
struct CompositorTests {
    @Test
    func sourceOverKeepsStraightRGBA() throws {
        var destination: [UInt8] = [0, 0, 255, 128]
        try Compositor.blend(
            source: [255, 0, 0, 128],
            onto: &destination,
            opacity: 1,
            compositeOp: .sourceOver,
            blendMode: .normal
        )

        #expect(destination == [170, 0, 85, 192])
    }

    @Test
    func destinationOutOnlyChangesCoverage() throws {
        var destination: [UInt8] = [12, 34, 56, 200]
        try Compositor.blend(
            source: [255, 0, 0, 128],
            onto: &destination,
            opacity: 1,
            compositeOp: .destinationOut,
            blendMode: .normal
        )

        #expect(destination == [12, 34, 56, 100])
    }

    @Test
    func multiplyUsesW3CBlendColor() throws {
        var destination: [UInt8] = [128, 64, 255, 255]
        try Compositor.blend(
            source: [128, 255, 64, 255],
            onto: &destination,
            opacity: 1,
            compositeOp: .sourceOver,
            blendMode: .multiply
        )

        #expect(destination == [64, 64, 64, 255])
    }
}
