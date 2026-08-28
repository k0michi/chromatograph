import Foundation
import PNG
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
          parents: [firstHash],
          compositeOp: second.compositeOp,
          blendMode: second.blendMode,
          opacity: second.opacity,
          imageBytes: second.imageBytes
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
        operation: .undo(.init(chunk: .init(x: 0, y: 0), parents: [blendHash]))
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
      color: PNG.RGBA<UInt8>(255, 0, 0, 255)
    )
    let invalid = BlendOperation(
      chunk: TileChunk(x: 1, y: 0),
      parents: [],
      compositeOp: .sourceOver,
      blendMode: .normal,
      opacity: 1,
      imageBytes: Data([0, 1, 2])
    )

    await #expect(throws: (any Error).self) {
      try await manager.apply(
        patch(hash: hash("10"), operations: [.blend(valid), .blend(invalid)]))
    }
    #expect(await manager.snapshot(x: 0, y: 0) == nil)
    #expect(await manager.snapshot(x: 1, y: 0) == nil)
  }

  @Test
  func rejectsMissingParentOnTheOperationChunkWithoutMutation() async throws {
    let manager = ChunkManager()
    let parentHash = hash("10")
    try await manager.apply(
      patch(
        hash: parentHash,
        operation: .blend(try blendOperation(color: PNG.RGBA<UInt8>(255, 0, 0, 255)))
      ))
    let before = await manager.snapshot(x: 0, y: 0)

    await #expect(
      throws: ChunkManagerError.missingParent(parentHash, TileChunk(x: 1, y: 0))
    ) {
      try await manager.apply(
        patch(
          hash: hash("20"),
          operation: .undo(
            UndoOperation(
              chunk: TileChunk(x: 1, y: 0),
              parents: [parentHash]
            ))
        ))
    }
    #expect(await manager.snapshot(x: 0, y: 0) == before)
    #expect(await manager.snapshot(x: 1, y: 0) == nil)
  }

  @Test
  func rejectsDuplicateChunksInOnePatch() async throws {
    let manager = ChunkManager()
    let chunk = TileChunk(x: 0, y: 0)

    await #expect(throws: ChunkManagerError.duplicateChunk(chunk)) {
      try await manager.apply(
        patch(
          hash: hash("10"),
          operations: [
            .undo(UndoOperation(chunk: chunk, parents: [])),
            .undo(UndoOperation(chunk: chunk, parents: [])),
          ]))
    }
    #expect(await manager.snapshot(x: 0, y: 0) == nil)
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
          operation: .undo(UndoOperation(chunk: chunk, parents: [patchHash]))
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
          try blendOperation(color: PNG.RGBA<UInt8>(255, 0, 0, 255))
        )
      ))
    #expect(await manager.snapshot(x: 0, y: 0)?.prefix(4) == [255, 0, 0, 255])

    let undoHash = hash("20")
    try await manager.apply(
      patch(
        hash: undoHash,
        operation: ChromatographBackend.Operation.undo(
          UndoOperation(chunk: TileChunk(x: 0, y: 0), parents: [blendHash])
        )
      ))
    #expect(await manager.snapshot(x: 0, y: 0)?.prefix(4) == [0, 0, 0, 0])

    try await manager.apply(
      patch(
        hash: hash("30"),
        operation: ChromatographBackend.Operation.undo(
          UndoOperation(chunk: TileChunk(x: 0, y: 0), parents: [undoHash])
        )
      ))
    #expect(await manager.snapshot(x: 0, y: 0)?.prefix(4) == [255, 0, 0, 255])
  }

  @Test
  func highestHashUndoBranchWins() async throws {
    let manager = ChunkManager()
    let blendHash = hash("10")
    try await manager.apply(
      patch(
        hash: blendHash,
        operation: ChromatographBackend.Operation.blend(
          try blendOperation(color: PNG.RGBA<UInt8>(0, 255, 0, 255))
        )
      ))

    let firstUndo = hash("20")
    try await manager.apply(
      patch(
        hash: firstUndo,
        operation: ChromatographBackend.Operation.undo(
          UndoOperation(chunk: TileChunk(x: 0, y: 0), parents: [blendHash])
        )
      ))
    try await manager.apply(
      patch(
        hash: hash("70"),
        operation: ChromatographBackend.Operation.undo(
          UndoOperation(chunk: TileChunk(x: 0, y: 0), parents: [firstUndo])
        )
      ))
    try await manager.apply(
      patch(
        hash: hash("90"),
        operation: ChromatographBackend.Operation.undo(
          UndoOperation(chunk: TileChunk(x: 0, y: 0), parents: [blendHash])
        )
      ))

    #expect(await manager.snapshot(x: 0, y: 0)?.prefix(4) == [0, 0, 0, 0])
  }

  @Test
  func rejectsUndoWhoseParentsRepresentDifferentStates() async throws {
    let manager = ChunkManager()
    let first = hash("10")
    let second = hash("20")
    try await manager.apply(
      patch(
        hash: first,
        operation: ChromatographBackend.Operation.blend(
          try blendOperation(color: PNG.RGBA<UInt8>(255, 0, 0, 255))
        )
      ))
    try await manager.apply(
      patch(
        hash: second,
        operation: ChromatographBackend.Operation.blend(
          try blendOperation(color: PNG.RGBA<UInt8>(0, 0, 255, 255))
        )
      ))

    await #expect(throws: ChunkManagerError.invalidUndoParents(hash("30"))) {
      try await manager.apply(
        patch(
          hash: hash("30"),
          operation: ChromatographBackend.Operation.undo(
            UndoOperation(chunk: TileChunk(x: 0, y: 0), parents: [first, second])
          )
        ))
    }
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
    let patchHash = hash("10")
    let firstManager = ChunkManager(store: store)
    try await firstManager.apply(
      patch(hash: patchHash, operation: .blend(try blendOperation(color: .init(255, 0, 0, 255))))
    )

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
  .init(
    operations: operations,
    publicKeyHex: String(repeating: "11", count: 32),
    hash: hash,
    signatureHex: String(repeating: "33", count: 64)
  )
}

private func blendOperation(
  chunk: TileChunk = TileChunk(x: 0, y: 0),
  color: PNG.RGBA<UInt8>
) throws -> BlendOperation {
  let pixels = [PNG.RGBA<UInt8>](repeating: color, count: 256 * 256)
  let image = PNG.Image(
    packing: pixels,
    size: (x: 256, y: 256),
    layout: .init(format: .rgba8(palette: [], fill: nil))
  )
  var destination = TestPNGDestination()
  try image.compress(stream: &destination, level: 0)
  return .init(
    chunk: chunk,
    parents: [],
    compositeOp: .sourceOver,
    blendMode: .normal,
    opacity: 1,
    imageBytes: Data(destination.bytes)
  )
}

private struct TestPNGDestination: PNG.BytestreamDestination {
  var bytes: [UInt8] = []
  mutating func write(_ bytes: [UInt8]) -> Void? {
    self.bytes.append(contentsOf: bytes)
    return ()
  }
}
