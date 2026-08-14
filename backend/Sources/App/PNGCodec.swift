import Foundation
import LibPNG

struct DecodedPNG: Sendable {
  let width: Int
  let height: Int
  let isRGBA8: Bool
  let rgba: [UInt8]
}

enum PNGCodec {
  static func decode(_ data: Data) throws -> DecodedPNG {
    do {
      let png = try ReadStruct.create()
      let info = try png.createInfoStruct()

      try png.setReadData(data)
      try png.readInfo(info)

      let header = try png.getIHDR(info)
      let sourceIsRGBA8 = header.bitDepth == 8 && header.colorType == .rgba
      let hasTransparency = try png.getValid(info, .transparency).contains(.transparency)

      if header.colorType == .palette ||
        (header.colorType == .grayscale && header.bitDepth < 8) ||
        hasTransparency
      {
        try png.setExpand()
      }
      if header.bitDepth == 16 {
        try png.setStrip16()
      }
      if header.colorType == .grayscale || header.colorType == .grayscaleAlpha {
        try png.setGrayToRGB()
      }
      if !header.colorType.hasAlpha && !hasTransparency {
        try png.setAddAlpha(0xff, after: true)
      }

      try png.readUpdateInfo(info)

      let rowBytes = try png.getRowBytes(info)
      let (byteCount, overflow) = rowBytes.multipliedReportingOverflow(by: Int(header.height))
      guard !overflow else {
        throw PNGCodecError.decodingFailed("decoded PNG byte count overflow")
      }

      var rgba = [UInt8](repeating: 0, count: byteCount)
      try png.readImage(info, into: &rgba, rowBytes: rowBytes)
      try png.readEnd(info)

      let expectedRowBytes = Int(header.width) * 4
      guard rowBytes == expectedRowBytes else {
        throw PNGCodecError.decodingFailed(
          "expected RGBA8 row size \(expectedRowBytes), got \(rowBytes)"
        )
      }

      return DecodedPNG(
        width: Int(header.width),
        height: Int(header.height),
        isRGBA8: sourceIsRGBA8,
        rgba: rgba
      )
    } catch let error as PNGCodecError {
      throw error
    } catch {
      throw PNGCodecError.decodingFailed(String(describing: error))
    }
  }

  static func encodeRGBA8(_ rgba: [UInt8], width: Int, height: Int) throws -> Data {
    let (pixelCount, pixelCountOverflow) = width.multipliedReportingOverflow(by: height)
    let (expectedCount, byteCountOverflow) = pixelCount.multipliedReportingOverflow(by: 4)
    guard
      width > 0, height > 0,
      width <= UInt32.max, height <= UInt32.max,
      !pixelCountOverflow, !byteCountOverflow,
      rgba.count == expectedCount
    else {
      throw PNGCodecError.invalidRGBAByteCount(rgba.count)
    }

    do {
      let png = try WriteStruct.create()
      let info = try png.createInfoStruct()
      let rowBytes = width * 4

      try png.setWriteData()
      try png.setIHDR(
        info,
        IHDR(
          width: UInt32(width),
          height: UInt32(height),
          bitDepth: 8,
          colorType: .rgba
        )
      )
      try png.writeInfo(info)

      try rgba.withUnsafeBufferPointer { pixels in
        for rowIndex in 0..<height {
          let start = rowIndex * rowBytes
          let row = UnsafeBufferPointer(rebasing: pixels[start..<start + rowBytes])
          try png.writeRow(info, row)
        }
      }

      try png.writeEnd(info)
      return try png.writeData()
    } catch {
      throw PNGCodecError.encodingFailed(String(describing: error))
    }
  }
}

enum PNGCodecError: Error, Equatable {
  case invalidRGBAByteCount(Int)
  case decodingFailed(String)
  case encodingFailed(String)
}

private extension ColorType {
  var hasAlpha: Bool {
    self == .grayscaleAlpha || self == .rgba
  }
}
