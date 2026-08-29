import Crypto
import Foundation
import LibPNG
import Testing

@testable import ChromatographBackend

@Suite
struct ChunkManagerTests {
  @Test
  func replayReturnsTheSnapshotBeforeBlendAndEveryFollowingPatch() async throws {
    let manager = ChunkManager()
    let firstHash = hash("10")
    try await manager.apply(
      patch(hash: firstHash, operation: .blend(try blendOperation(color: .init(255, 0, 0, 255))))
    )
    let secondHash = hash("20")
    let second = try blendOperation(color: .init(0, 255, 0, 255))
    try await manager.apply(
      patch(
        hash: secondHash,
        operation: .blend(.init(
          chunk: second.chunk,
          parent: firstHash,
          compositeOp: second.compositeOp,
          blendMode: second.blendMode,
          opacity: second.opacity,
          payloadHash: second.payloadHash
        ))
      ))

    let replay = try await manager.replay(x: 0, y: 0, from: secondHash)
    #expect(replay.containsEntireOrder == false)
    #expect(try PNGCodec.decode(replay.imageBytes).rgba.prefix(4) == [255, 0, 0, 255])
    #expect(replay.patches.map(\.hash) == [secondHash])
  }

  @Test
  func replayForUndoStartsBeforeItsTargetBlend() async throws {
    let manager = ChunkManager()
    let blendHash = hash("10")
    try await manager.apply(
      patch(hash: blendHash, operation: .blend(try blendOperation(color: .init(0, 0, 255, 255))))
    )
    let undoHash = hash("20")
    try await manager.apply(
      patch(
        hash: undoHash,
        operation: .undo(.init(targetPatchHash: blendHash))
      ))

    let replay = try await manager.replay(x: 0, y: 0, from: undoHash)
    #expect(replay.containsEntireOrder == true)
    #expect(try PNGCodec.decode(replay.imageBytes).rgba.prefix(4) == [0, 0, 0, 0])
    #expect(replay.patches.map(\.hash) == [blendHash, undoHash])
  }

  @Test
  func serverSnapshotUsesOneIDATChunkForFastPNGCompatibility() throws {
    let rgba = [UInt8](repeating: 127, count: 256 * 256 * 4)
    let png = try PNGCodec.encodeRGBA8(rgba, width: 256, height: 256)
    #expect(pngChunkTypes(png).filter { $0 == "IDAT" }.count == 1)
  }

  @Test
  func appliesAllChunksAtomically() async throws {
    let manager = ChunkManager()
    let valid = try blendOperation(
      chunk: TileChunk(x: 0, y: 0),
      color: .init(255, 0, 0, 255)
    )
    let invalid = BlendOperation(
      chunk: TileChunk(x: 1, y: 0),
      parent: rootPatchHash,
      compositeOp: .sourceOver,
      blendMode: .normal,
      opacity: 255,
      payloadHash: registerManagerImage(Data([0, 1, 2]))
    )

    await #expect(throws: (any Error).self) {
      try await manager.apply(
        patch(hash: hash("10"), operations: [.blend(valid), .blend(invalid)]))
    }
    #expect(try await manager.snapshot(x: 0, y: 0) == nil)
    #expect(try await manager.snapshot(x: 1, y: 0) == nil)
  }

  @Test
  func rejectsMissingUndoTargetWithoutMutation() async throws {
    let manager = ChunkManager()
    let parentHash = hash("10")
    try await manager.apply(
      patch(
        hash: parentHash,
        operation: .blend(try blendOperation(color: .init(255, 0, 0, 255)))
      ))
    let before = try await manager.snapshot(x: 0, y: 0)

    let missing = hash("99")
    await #expect(throws: ChunkManagerError.missingParent(missing, TileChunk(x: 0, y: 0))) {
      try await manager.apply(
        patch(
          hash: hash("20"),
          operation: .undo(UndoOperation(targetPatchHash: missing))
        ))
    }
    #expect(try await manager.snapshot(x: 0, y: 0) == before)
    #expect(try await manager.snapshot(x: 1, y: 0) == nil)
  }

  @Test
  func rejectsDuplicateChunksInOnePatch() async throws {
    let manager = ChunkManager()
    let chunk = TileChunk(x: 0, y: 0)
    let target = hash("01")
    _ = try await manager.apply(patch(hash: target, operation: .blend(try blendOperation(color: .init(1, 2, 3, 255)))))
    let before = try await manager.snapshot(x: 0, y: 0)

    await #expect(throws: ChunkManagerError.duplicateChunk(chunk)) {
      try await manager.apply(
        patch(
          hash: hash("10"),
          operations: [
            .undo(UndoOperation(targetPatchHash: target)),
            .undo(UndoOperation(targetPatchHash: target)),
          ]))
    }
    #expect(try await manager.snapshot(x: 0, y: 0) == before)
  }

  @Test
  func rejectsSelfParent() async throws {
    let manager = ChunkManager()
    let patchHash = hash("10")
    let chunk = TileChunk(x: 0, y: 0)

    await #expect(throws: ChunkManagerError.selfParent(patchHash, chunk)) {
      try await manager.apply(
        patch(
          hash: patchHash,
          operation: .undo(UndoOperation(targetPatchHash: patchHash))
        ))
    }
  }

  @Test
  func undoAndRedoRebuildTheSnapshot() async throws {
    let manager = ChunkManager()
    let blendHash = hash("10")
    try await manager.apply(
      patch(
        hash: blendHash,
        operation: ChromatographBackend.Operation.blend(
          try blendOperation(color: .init(255, 0, 0, 255))
        )
      ))
    #expect(try await manager.snapshot(x: 0, y: 0)?.prefix(4) == [255, 0, 0, 255])

    let undoHash = hash("20")
    try await manager.apply(
      patch(
        hash: undoHash,
        operation: ChromatographBackend.Operation.undo(
          UndoOperation(targetPatchHash: blendHash)
        )
      ))
    #expect(try await manager.snapshot(x: 0, y: 0)?.prefix(4) == [0, 0, 0, 0])

    try await manager.apply(
      patch(
        hash: hash("30"),
        operation: ChromatographBackend.Operation.undo(
          UndoOperation(targetPatchHash: undoHash)
        )
      ))
    #expect(try await manager.snapshot(x: 0, y: 0)?.prefix(4) == [255, 0, 0, 255])
  }

  @Test
  func highestHashUndoBranchWins() async throws {
    let manager = ChunkManager()
    let blendHash = hash("10")
    try await manager.apply(
      patch(
        hash: blendHash,
        operation: ChromatographBackend.Operation.blend(
          try blendOperation(color: .init(0, 255, 0, 255))
        )
      ))

    let firstUndo = hash("20")
    try await manager.apply(
      patch(
        hash: firstUndo,
        operation: ChromatographBackend.Operation.undo(
          UndoOperation(targetPatchHash: blendHash)
        )
      ))
    try await manager.apply(
      patch(
        hash: hash("70"),
        operation: ChromatographBackend.Operation.undo(
          UndoOperation(targetPatchHash: firstUndo)
        )
      ))
    try await manager.apply(
      patch(
        hash: hash("90"),
        operation: ChromatographBackend.Operation.undo(
          UndoOperation(targetPatchHash: blendHash)
        )
      ))

    #expect(try await manager.snapshot(x: 0, y: 0)?.prefix(4) == [0, 0, 0, 0])
  }

  @Test
  func fileSystemStoreRestoresPatchesAndSnapshotsFromSeparateDirectories() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
      path: "chromatograph-store-\(UUID().uuidString)",
      directoryHint: .isDirectory
    )
    defer { try? FileManager.default.removeItem(at: root) }
    let metadata = root.appending(path: "metadata", directoryHint: .isDirectory)
    let snapshotCache = root.appending(path: "snapshots", directoryHint: .isDirectory)
    let store = try FileSystemChunkStore(
      metadataDirectory: metadata,
      snapshotDirectory: snapshotCache
    )
    let storedPatch = try canonicalPatch(operations: [.blend(try blendOperation(color: .init(255, 0, 0, 255)))])
    let patchHash = storedPatch.hash
    let firstManager = ChunkManager(store: store)
    try await firstManager.apply(storedPatch)

    let restoredManager = ChunkManager(store: try FileSystemChunkStore(
      metadataDirectory: metadata,
      snapshotDirectory: snapshotCache
    ))
    let restored = try await restoredManager.latestSnapshots(for: [.init(x: 0, y: 0)])
    #expect(restored.count == 1)
    #expect(restored[0].headPatchHash == patchHash)
    #expect(try PNGCodec.decode(restored[0].imageBytes).rgba.prefix(4) == [255, 0, 0, 255])
    let patchFile = metadata.appending(path: "patches/\(patchHash).patch")
    let snapshotFile = snapshotCache.appending(path: "0/0/\(patchHash).png")
    #expect(FileManager.default.fileExists(atPath: patchFile.path))
    #expect(FileManager.default.fileExists(atPath: snapshotFile.path))

    try FileManager.default.removeItem(at: snapshotFile)
    let managerWithoutCache = ChunkManager(store: try FileSystemChunkStore(
      metadataDirectory: metadata,
      snapshotDirectory: snapshotCache
    ))
    let recomputed = try await managerWithoutCache.latestSnapshots(for: [.init(x: 0, y: 0)])
    #expect(try PNGCodec.decode(recomputed[0].imageBytes).rgba.prefix(4) == [255, 0, 0, 255])
    #expect(FileManager.default.fileExists(atPath: snapshotFile.path))
  }
}

private func hash(_ byte: String) -> String { String(repeating: byte, count: 32) }

private func pngChunkTypes(_ png: Data) -> [String] {
  let bytes = [UInt8](png)
  var offset = 8
  var types: [String] = []
  while offset + 12 <= bytes.count {
    let length = bytes[offset..<(offset + 4)].reduce(0) { ($0 << 8) | Int($1) }
    guard offset + 12 + length <= bytes.count else { break }
    types.append(String(bytes: bytes[(offset + 4)..<(offset + 8)], encoding: .ascii) ?? "")
    offset += 12 + length
  }
  return types
}

private func patch(hash: String, operation: ChromatographBackend.Operation) -> Patch {
  patch(hash: hash, operations: [operation])
}

private func patch(hash: String, operations: [ChromatographBackend.Operation]) -> Patch {
  let hashes = Set(operations.compactMap { if case .blend(let blend) = $0 { blend.payloadHash } else { nil } }).sorted()
  return .init(
    operations: operations,
    publicKeyHex: String(repeating: "11", count: 32),
    timestamp: 0,
    hash: hash,
    signatureHex: String(repeating: "33", count: 64),
    images: hashes.compactMap(managerImage(for:))
  )
}

private func canonicalPatch(operations: [ChromatographBackend.Operation]) throws -> Patch {
  let publicKey = String(repeating: "11", count: 32)
  let payload = try OperationPacketCodec.encodePayload(operations: operations, publicKeyHex: publicKey, timestamp: 0)
  return patch(hash: Data(SHA256.hash(data: payload)).cborHex, operations: operations)
}

private func blendOperation(
  chunk: TileChunk = TileChunk(x: 0, y: 0),
  color: RGBA
) throws -> BlendOperation {
  let data = try encodeRGBA8(Array(repeating: [color.red, color.green, color.blue, color.alpha], count: 256 * 256).flatMap { $0 })
  let payloadHash = registerManagerImage(data)
  return .init(
    chunk: chunk,
    parent: rootPatchHash,
    compositeOp: .sourceOver,
    blendMode: .normal,
    opacity: 255,
    payloadHash: payloadHash
  )
}

nonisolated(unsafe) private var managerImages: [String: Data] = [:]
private let managerImagesLock = NSLock()

private func registerManagerImage(_ data: Data) -> String {
  let value = Data(SHA256.hash(data: data)).cborHex
  managerImagesLock.lock()
  defer { managerImagesLock.unlock() }
  managerImages[value] = data
  return value
}

private func managerImage(for hash: String) -> Data? {
  managerImagesLock.lock()
  defer { managerImagesLock.unlock() }
  return managerImages[hash]
}

private struct RGBA {
  let red: UInt8
  let green: UInt8
  let blue: UInt8
  let alpha: UInt8

  init(_ red: UInt8, _ green: UInt8, _ blue: UInt8, _ alpha: UInt8) {
    self.red = red
    self.green = green
    self.blue = blue
    self.alpha = alpha
  }
}

private func encodeRGBA8(_ pixels: [UInt8]) throws -> Data {
  let write = try WriteStruct.create()
  let info = try write.createInfoStruct()
  try write.setWriteData()
  try write.setIHDR(info, .init(width: 256, height: 256, bitDepth: 8, colorType: .rgba))
  try write.writeInfo(info)
  for offset in stride(from: 0, to: pixels.count, by: 256 * 4) {
    try write.writeRow(info, Array(pixels[offset..<(offset + 256 * 4)]))
  }
  try write.writeEnd(info)
  return try write.writeData()
}
