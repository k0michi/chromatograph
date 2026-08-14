import Foundation
import LibPNG
import Testing

@Test
func rowReadWriteRoundTrip() throws {
  let header = IHDR(
    width: 2,
    height: 1,
    bitDepth: 8,
    colorType: .rgba
  )
  let pixels: [UInt8] = [255, 0, 0, 255, 0, 255, 0, 128]

  let write = try WriteStruct.create()
  let writeInfo = try write.createInfoStruct()

  try write.setWriteData()
  try write.setIHDR(writeInfo, header)
  try write.writeInfo(writeInfo)
  try write.writeRow(writeInfo, pixels)

  try write.writeEnd(writeInfo)
  let data = try write.writeData()

  let read = try ReadStruct.create()
  let readInfo = try read.createInfoStruct()

  try read.setReadData(data)
  try read.readInfo(readInfo)

  #expect(try read.getIHDR(readInfo) == header)

  try read.readUpdateInfo(readInfo)

  let rowByteCount = try read.getRowBytes(readInfo)
  var row = [UInt8](repeating: 0, count: rowByteCount)
  var displayRow: [UInt8]?

  try read.readRow(readInfo, &row, displayRow: &displayRow)
  try read.readEnd(readInfo)

  #expect(row == pixels)
}

@Test
func libpngLongjmpBecomesThrow() throws {
  let read = try ReadStruct.create()
  let info = try read.createInfoStruct()

  try read.setReadData(Data("not png".utf8))

  #expect(throws: LibPNGError.self) {
    try read.readInfo(info)
  }
}

@Test
func rejectsForeignInfoStruct() throws {
  let first = try ReadStruct.create()
  let second = try ReadStruct.create()
  let info = try first.createInfoStruct()

  #expect(throws: LibPNGError.self) {
    try second.readInfo(info)
  }
}
