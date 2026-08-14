import CLibPNGBridge
import Foundation

public struct LibPNGError: Swift.Error, Equatable, Sendable, CustomStringConvertible {
  public let function: String
  public let message: String

  public var description: String {
    "\(function): \(message)"
  }
}

public enum ColorType: Int32, Sendable {
  case grayscale = 0
  case rgb = 2
  case palette = 3
  case grayscaleAlpha = 4
  case rgba = 6
}

public enum InterlaceMethod: Int32, Sendable {
  case none = 0
  case adam7 = 1
}

public struct InfoFlag: OptionSet, Sendable {
  public let rawValue: UInt32

  public init(rawValue: UInt32) {
    self.rawValue = rawValue
  }

  public static let transparency = InfoFlag(rawValue: UInt32(SLPNG_INFO_tRNS))
}

public struct IHDR: Equatable, Sendable {
  public var width: UInt32
  public var height: UInt32
  public var bitDepth: Int32
  public var colorType: ColorType
  public var interlaceMethod: InterlaceMethod

  public init(
    width: UInt32,
    height: UInt32,
    bitDepth: Int32,
    colorType: ColorType,
    interlaceMethod: InterlaceMethod = .none
  ) {
    self.width = width
    self.height = height
    self.bitDepth = bitDepth
    self.colorType = colorType
    self.interlaceMethod = interlaceMethod
  }
}

public final class ReadInfoStruct {
  fileprivate let handle: OpaquePointer
  fileprivate let owner: ReadStruct

  fileprivate init(handle: OpaquePointer, owner: ReadStruct) {
    self.handle = handle
    self.owner = owner
  }

  deinit {
    slpng_destroy_info_struct(handle)
  }
}

public final class WriteInfoStruct {
  fileprivate let handle: OpaquePointer
  fileprivate let owner: WriteStruct

  fileprivate init(handle: OpaquePointer, owner: WriteStruct) {
    self.handle = handle
    self.owner = owner
  }

  deinit {
    slpng_destroy_info_struct(handle)
  }
}

public final class ReadStruct {
  fileprivate let handle: OpaquePointer

  private init(handle: OpaquePointer) {
    self.handle = handle
  }

  /// Corresponds to `png_create_read_struct`.
  public static func create() throws -> ReadStruct {
    var error = slpng_error()

    guard let handle = slpng_create_read_struct(&error) else {
      throw makeError(function: "png_create_read_struct", value: error)
    }

    return ReadStruct(handle: handle)
  }

  /// Corresponds to `png_destroy_read_struct`.
  deinit {
    slpng_destroy_read_struct(handle)
  }

  /// Corresponds to `png_create_info_struct`.
  public func createInfoStruct() throws -> ReadInfoStruct {
    var error = slpng_error()

    guard let infoHandle = slpng_create_read_info_struct(handle, &error) else {
      throw makeError(function: "png_create_info_struct", value: error)
    }

    return ReadInfoStruct(handle: infoHandle, owner: self)
  }

  /// Installs an in-memory implementation of `png_set_read_fn`.
  public func setReadData(_ data: Data) throws {
    try data.withUnsafeBytes { bytes in
      try call("png_set_read_fn") { error in
        slpng_set_read_data(
          handle,
          bytes.bindMemory(to: UInt8.self).baseAddress,
          bytes.count,
          error
        )
      }
    }
  }

  /// Corresponds to `png_read_info`.
  public func readInfo(_ info: ReadInfoStruct) throws {
    try validateOwnership(of: info)
    try call("png_read_info") { error in
      slpng_read_info(handle, info.handle, error)
    }
  }

  /// Corresponds to `png_get_IHDR`.
  public func getIHDR(_ info: ReadInfoStruct) throws -> IHDR {
    try validateOwnership(of: info)

    var value = slpng_ihdr()
    try call("png_get_IHDR") { error in
      slpng_get_IHDR_read(handle, info.handle, &value, error)
    }

    guard
      let colorType = ColorType(rawValue: Int32(value.color_type)),
      let interlaceMethod = InterlaceMethod(rawValue: Int32(value.interlace_method))
    else {
      throw LibPNGError(function: "png_get_IHDR", message: "unknown enum value")
    }

    return IHDR(
      width: value.width,
      height: value.height,
      bitDepth: Int32(value.bit_depth),
      colorType: colorType,
      interlaceMethod: interlaceMethod
    )
  }

  /// Corresponds to `png_set_expand`.
  public func setExpand() throws {
    try call("png_set_expand") { slpng_set_expand(handle, $0) }
  }

  /// Corresponds to `png_set_strip_16`.
  public func setStrip16() throws {
    try call("png_set_strip_16") { slpng_set_strip_16(handle, $0) }
  }

  /// Corresponds to `png_set_gray_to_rgb`.
  public func setGrayToRGB() throws {
    try call("png_set_gray_to_rgb") { slpng_set_gray_to_rgb(handle, $0) }
  }

  /// Corresponds to `png_set_add_alpha`.
  public func setAddAlpha(_ filler: UInt32, after: Bool) throws {
    try call("png_set_add_alpha") { error in
      slpng_set_add_alpha(handle, filler, after ? 1 : 0, error)
    }
  }

  /// Corresponds to `png_read_update_info`.
  public func readUpdateInfo(_ info: ReadInfoStruct) throws {
    try validateOwnership(of: info)
    try call("png_read_update_info") { error in
      slpng_read_update_info(handle, info.handle, error)
    }
  }

  /// Corresponds to `png_get_rowbytes`.
  public func getRowBytes(_ info: ReadInfoStruct) throws -> Int {
    try validateOwnership(of: info)
    return slpng_get_rowbytes(handle, info.handle)
  }

  /// Corresponds to `png_get_channels`.
  public func getChannels(_ info: ReadInfoStruct) throws -> Int {
    try validateOwnership(of: info)
    return Int(slpng_get_channels(handle, info.handle))
  }

  /// Corresponds to `png_get_valid`.
  public func getValid(
    _ info: ReadInfoStruct,
    _ flag: InfoFlag
  ) throws -> InfoFlag {
    try validateOwnership(of: info)
    let rawValue = slpng_get_valid(handle, info.handle, flag.rawValue)
    return InfoFlag(rawValue: rawValue)
  }

  /// Corresponds to `png_read_image`.
  public func readImage(
    _ info: ReadInfoStruct,
    into pixels: inout [UInt8],
    rowBytes: Int
  ) throws {
    try validateOwnership(of: info)

    let requiredRowBytes = slpng_get_rowbytes(handle, info.handle)
    guard rowBytes >= requiredRowBytes else {
      throw LibPNGError(
        function: "png_read_image",
        message: "rowBytes is smaller than png_get_rowbytes"
      )
    }

    try pixels.withUnsafeMutableBufferPointer { buffer in
      try call("png_read_image") { error in
        slpng_read_image(
          handle,
          info.handle,
          buffer.baseAddress,
          buffer.count,
          rowBytes,
          error
        )
      }
    }
  }

  /// Corresponds to `png_read_row`.
  public func readRow(
    _ info: ReadInfoStruct,
    _ row: inout [UInt8],
    displayRow: inout [UInt8]?
  ) throws {
    try validateOwnership(of: info)

    let requiredByteCount = slpng_get_rowbytes(handle, info.handle)
    try validateRowBuffer(row, requiredByteCount: requiredByteCount)

    if let displayRow {
      try validateRowBuffer(displayRow, requiredByteCount: requiredByteCount)
    }

    try row.withUnsafeMutableBufferPointer { rowBuffer in
      if var displayBytes = displayRow {
        try displayBytes.withUnsafeMutableBufferPointer { displayBuffer in
          try call("png_read_row") { error in
            slpng_read_row(
              handle,
              rowBuffer.baseAddress,
              rowBuffer.count,
              displayBuffer.baseAddress,
              displayBuffer.count,
              error
            )
          }
        }
        displayRow = displayBytes
      } else {
        try call("png_read_row") { error in
          slpng_read_row(
            handle,
            rowBuffer.baseAddress,
            rowBuffer.count,
            nil,
            0,
            error
          )
        }
      }
    }
  }

  /// Corresponds to `png_read_end`.
  public func readEnd(_ info: ReadInfoStruct?) throws {
    if let info {
      try validateOwnership(of: info)
    }

    try call("png_read_end") { error in
      slpng_read_end(handle, info?.handle, error)
    }
  }

  private func validateOwnership(of info: ReadInfoStruct) throws {
    guard info.owner === self else {
      throw LibPNGError(
        function: "png_info",
        message: "info struct belongs to another read struct"
      )
    }
  }

  private func validateRowBuffer(
    _ row: [UInt8],
    requiredByteCount: Int
  ) throws {
    guard row.count >= requiredByteCount else {
      throw LibPNGError(
        function: "png_read_row",
        message: "row buffer is smaller than png_get_rowbytes"
      )
    }
  }

  private func call(
    _ function: String,
    _ body: (UnsafeMutablePointer<slpng_error>) -> Int32
  ) throws {
    var error = slpng_error()
    guard body(&error) != 0 else {
      throw makeError(function: function, value: error)
    }
  }
}

public final class WriteStruct {
  fileprivate let handle: OpaquePointer

  private init(handle: OpaquePointer) {
    self.handle = handle
  }

  /// Corresponds to `png_create_write_struct`.
  public static func create() throws -> WriteStruct {
    var error = slpng_error()

    guard let handle = slpng_create_write_struct(&error) else {
      throw makeError(function: "png_create_write_struct", value: error)
    }

    return WriteStruct(handle: handle)
  }

  /// Corresponds to `png_destroy_write_struct`.
  deinit {
    slpng_destroy_write_struct(handle)
  }

  /// Corresponds to `png_create_info_struct`.
  public func createInfoStruct() throws -> WriteInfoStruct {
    var error = slpng_error()

    guard let infoHandle = slpng_create_write_info_struct(handle, &error) else {
      throw makeError(function: "png_create_info_struct", value: error)
    }

    return WriteInfoStruct(handle: infoHandle, owner: self)
  }

  /// Installs an in-memory implementation of `png_set_write_fn`.
  public func setWriteData() throws {
    try call("png_set_write_fn") { slpng_set_write_data(handle, $0) }
  }

  /// Corresponds to `png_set_IHDR`.
  public func setIHDR(_ info: WriteInfoStruct, _ value: IHDR) throws {
    try validateOwnership(of: info)

    var rawValue = slpng_ihdr(
      width: value.width,
      height: value.height,
      bit_depth: value.bitDepth,
      color_type: value.colorType.rawValue,
      interlace_method: value.interlaceMethod.rawValue,
      compression_method: 0,
      filter_method: 0
    )

    try call("png_set_IHDR") { error in
      slpng_set_IHDR_write(handle, info.handle, &rawValue, error)
    }
  }

  /// Corresponds to `png_write_info`.
  public func writeInfo(_ info: WriteInfoStruct) throws {
    try validateOwnership(of: info)
    try call("png_write_info") { error in
      slpng_write_info(handle, info.handle, error)
    }
  }

  /// Corresponds to `png_write_row`.
  public func writeRow(_ info: WriteInfoStruct, _ row: [UInt8]) throws {
    try row.withUnsafeBufferPointer { rowBuffer in
      try writeRow(info, rowBuffer)
    }
  }

  /// Corresponds to `png_write_row` with borrowed Swift storage.
  public func writeRow(
    _ info: WriteInfoStruct,
    _ row: UnsafeBufferPointer<UInt8>
  ) throws {
    try validateOwnership(of: info)

    let requiredByteCount = slpng_get_rowbytes_write(handle, info.handle)
    guard row.count >= requiredByteCount else {
      throw LibPNGError(
        function: "png_write_row",
        message: "row buffer is smaller than png_get_rowbytes"
      )
    }

    try call("png_write_row") { error in
      slpng_write_row(
        handle,
        row.baseAddress,
        row.count,
        error
      )
    }
  }

  /// Corresponds to `png_write_end`.
  public func writeEnd(_ info: WriteInfoStruct?) throws {
    if let info {
      try validateOwnership(of: info)
    }

    try call("png_write_end") { error in
      slpng_write_end(handle, info?.handle, error)
    }
  }

  /// Returns a copy of the output produced by the memory I/O adapter.
  public func writeData() throws -> Data {
    let byteCount = slpng_write_size(handle)
    guard let bytes = slpng_write_data(handle) else {
      throw LibPNGError(function: "writeData", message: "no output")
    }

    return Data(bytes: bytes, count: byteCount)
  }

  private func validateOwnership(of info: WriteInfoStruct) throws {
    guard info.owner === self else {
      throw LibPNGError(
        function: "png_info",
        message: "info struct belongs to another write struct"
      )
    }
  }

  private func call(
    _ function: String,
    _ body: (UnsafeMutablePointer<slpng_error>) -> Int32
  ) throws {
    var error = slpng_error()
    guard body(&error) != 0 else {
      throw makeError(function: function, value: error)
    }
  }
}

private func makeError(function: String, value: slpng_error) -> LibPNGError {
  var value = value
  let message = withUnsafeBytes(of: &value.message) { bytes in
    String(decoding: bytes.prefix { $0 != 0 }, as: UTF8.self)
  }

  return LibPNGError(
    function: function,
    message: message.isEmpty ? "operation failed" : message
  )
}
