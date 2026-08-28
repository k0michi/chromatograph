import Foundation

/// Payload-free description of a committed patch. Restoring the DAG needs only
/// this; the operation images stay on disk until a render or replay pulls them.
struct PatchSummary: Sendable {
  let hash: String
  let operations: [OperationSummary]

  init(hash: String, operations: [OperationSummary]) {
    self.hash = hash
    self.operations = operations
  }

  init(_ patch: Patch) {
    self.init(
      hash: patch.hash,
      operations: patch.operations.map(OperationSummary.init)
    )
  }
}

struct OperationSummary: Sendable {
  let chunk: TileChunk
  let parents: [String]
  /// `nil` marks an undo operation, which carries no pixels.
  let blend: BlendParameters?

  init(chunk: TileChunk, parents: [String], blend: BlendParameters?) {
    self.chunk = chunk
    self.parents = parents
    self.blend = blend
  }

  init(_ operation: Operation) {
    switch operation {
    case .blend(let operation):
      self.init(
        chunk: operation.chunk,
        parents: operation.parents,
        blend: BlendParameters(
          compositeOp: operation.compositeOp,
          blendMode: operation.blendMode,
          opacity: operation.opacity
        )
      )
    case .undo(let operation):
      self.init(chunk: operation.chunk, parents: operation.parents, blend: nil)
    }
  }
}

struct BlendParameters: Sendable, Equatable {
  let compositeOp: CompositeOp
  let blendMode: BlendMode
  let opacity: Float
}

struct StoredChunkState: Sendable {
  let patches: [PatchSummary]
}

protocol ChunkStore: Sendable {
  func load() throws -> StoredChunkState
  /// Returns the full patch (including operation images) by hash, or `nil` when
  /// the store has no such patch.
  func patch(hash: String) throws -> Patch?
  func snapshot(x: Int32, y: Int32, headPatchHash: String) throws -> Data?
  func storeSnapshots(_ snapshots: [ChunkSnapshot]) throws
  func commit(patch: Patch, snapshots: [ChunkSnapshot]) throws
}

/// Keeps everything in memory. Used when no storage paths are configured; it has
/// no durability, so it retains committed patches to stay a valid source of truth.
final class MemoryChunkStore: ChunkStore, @unchecked Sendable {
  private var patches: [String: Patch] = [:]
  private var order: [String] = []

  func load() throws -> StoredChunkState {
    .init(patches: order.compactMap { patches[$0] }.map(PatchSummary.init))
  }

  func patch(hash: String) throws -> Patch? { patches[hash] }
  func snapshot(x: Int32, y: Int32, headPatchHash: String) throws -> Data? { nil }
  func storeSnapshots(_ snapshots: [ChunkSnapshot]) throws {}

  func commit(patch: Patch, snapshots: [ChunkSnapshot]) throws {
    if patches[patch.hash] == nil { order.append(patch.hash) }
    patches[patch.hash] = patch
  }
}

/// Stores immutable Patch files as the source of truth and PNG snapshots as a disposable cache.
final class FileSystemChunkStore: ChunkStore, @unchecked Sendable {
  private let snapshotDirectory: URL
  private let patchesDirectory: URL
  private let fileManager = FileManager.default

  init(metadataDirectory: URL, snapshotDirectory: URL) throws {
    self.snapshotDirectory = snapshotDirectory
    patchesDirectory = metadataDirectory.appending(path: "patches", directoryHint: .isDirectory)
    try fileManager.createDirectory(at: patchesDirectory, withIntermediateDirectories: true)
    try fileManager.createDirectory(at: snapshotDirectory, withIntermediateDirectories: true)
  }

  func load() throws -> StoredChunkState {
    let patchURLs = try fileManager.contentsOfDirectory(
      at: patchesDirectory,
      includingPropertiesForKeys: nil
    ).filter { $0.pathExtension == "patch" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
    // Decode one file at a time and keep only the summary so restoring a large
    // canvas never holds every patch's pixels in memory at once.
    let summaries = try patchURLs.map { url in
      PatchSummary(try PatchPacketCodec.decode(Data(contentsOf: url)))
    }
    return .init(patches: summaries)
  }

  func patch(hash: String) throws -> Patch? {
    let url = patchesDirectory.appending(path: "\(hash).patch")
    guard fileManager.fileExists(atPath: url.path) else { return nil }
    return try PatchPacketCodec.decode(Data(contentsOf: url))
  }

  func snapshot(x: Int32, y: Int32, headPatchHash: String) throws -> Data? {
    let url = snapshotURL(x: x, y: y, headPatchHash: headPatchHash)
    guard fileManager.fileExists(atPath: url.path) else { return nil }
    return try Data(contentsOf: url, options: .mappedIfSafe)
  }

  func storeSnapshots(_ snapshots: [ChunkSnapshot]) throws {
    for snapshot in snapshots {
      let directory = snapshotDirectory
        .appending(path: String(snapshot.chunk.x), directoryHint: .isDirectory)
        .appending(path: String(snapshot.chunk.y), directoryHint: .isDirectory)
      try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
      try snapshot.imageBytes.write(
        to: snapshotURL(
          x: snapshot.chunk.x,
          y: snapshot.chunk.y,
          headPatchHash: snapshot.headPatchHash
        ),
        options: .atomic
      )
    }
  }

  func commit(patch: Patch, snapshots: [ChunkSnapshot]) throws {
    // Snapshot files are written first. The atomic Patch write is the commit point;
    // snapshots left by an interrupted write are harmless cache entries.
    try storeSnapshots(snapshots)
    try PatchPacketCodec.encode(patch).write(
      to: patchesDirectory.appending(path: "\(patch.hash).patch"),
      options: .atomic
    )
  }

  private func snapshotURL(x: Int32, y: Int32, headPatchHash: String) -> URL {
    snapshotDirectory
      .appending(path: String(x), directoryHint: .isDirectory)
      .appending(path: String(y), directoryHint: .isDirectory)
      .appending(path: "\(headPatchHash).png")
  }
}
