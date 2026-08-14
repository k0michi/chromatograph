import Foundation

enum CompositorError: Error, Equatable {
    case invalidByteCount(expected: Int, actual: Int)
    case invalidOpacity(Float)
}

/// Composites straight RGBA8 pixels and quantizes every result back to RGBA8.
enum Compositor {
    static func blend(
        source: [UInt8],
        onto destination: inout [UInt8],
        opacity: Float,
        compositeOp: CompositeOp,
        blendMode: BlendMode
    ) throws {
        guard source.count == destination.count, source.count.isMultiple(of: 4) else {
            throw CompositorError.invalidByteCount(expected: destination.count, actual: source.count)
        }
        guard opacity.isFinite, (0 ... 1).contains(opacity) else {
            throw CompositorError.invalidOpacity(opacity)
        }

        let opacity = Double(opacity)
        for offset in stride(from: 0, to: source.count, by: 4) {
            let sourceColor = SIMD3<Double>(
                Double(source[offset]) / 255,
                Double(source[offset + 1]) / 255,
                Double(source[offset + 2]) / 255
            )
            let destinationColor = SIMD3<Double>(
                Double(destination[offset]) / 255,
                Double(destination[offset + 1]) / 255,
                Double(destination[offset + 2]) / 255
            )
            let sourceAlpha = Double(source[offset + 3]) / 255 * opacity
            let destinationAlpha = Double(destination[offset + 3]) / 255
            let blended = blendColor(backdrop: destinationColor, source: sourceColor, mode: blendMode)
            let blendedSource = sourceColor * (1 - destinationAlpha) + blended * destinationAlpha

            let factors: (source: Double, destination: Double) = switch compositeOp {
            case .sourceOver: (1, 1 - sourceAlpha)
            case .destinationOut: (0, 1 - sourceAlpha)
            case .sourceIn: (destinationAlpha, 0)
            case .sourceAtop: (destinationAlpha, 1 - sourceAlpha)
            }
            let outputAlpha = sourceAlpha * factors.source + destinationAlpha * factors.destination
            let premultiplied = blendedSource * (sourceAlpha * factors.source)
                + destinationColor * (destinationAlpha * factors.destination)
            let outputColor = outputAlpha > 0 ? premultiplied / outputAlpha : .zero

            destination[offset] = quantize(outputColor.x)
            destination[offset + 1] = quantize(outputColor.y)
            destination[offset + 2] = quantize(outputColor.z)
            destination[offset + 3] = quantize(outputAlpha)
        }
    }

    private static func blendColor(
        backdrop: SIMD3<Double>,
        source: SIMD3<Double>,
        mode: BlendMode
    ) -> SIMD3<Double> {
        switch mode {
        case .normal:
            source
        case .multiply:
            backdrop * source
        case .screen:
            SIMD3(repeating: 1) - (SIMD3(repeating: 1) - backdrop) * (SIMD3(repeating: 1) - source)
        case .overlay:
            SIMD3(
                overlay(backdrop.x, source.x),
                overlay(backdrop.y, source.y),
                overlay(backdrop.z, source.z)
            )
        }
    }

    private static func overlay(_ backdrop: Double, _ source: Double) -> Double {
        backdrop <= 0.5
            ? 2 * backdrop * source
            : 1 - 2 * (1 - backdrop) * (1 - source)
    }

    private static func quantize(_ value: Double) -> UInt8 {
        UInt8((min(1, max(0, value)) * 255).rounded())
    }
}
