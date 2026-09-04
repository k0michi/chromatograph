import Foundation

/// Payload-free description of a committed patch. Restoring the DAG needs only
/// this; the operation images stay on disk until a render or replay pulls them.
struct PatchSummary: Sendable {
  let hash: String
  let operations: [Operation]

  init(hash: String, operations: [Operation]) {
    self.hash = hash
    self.operations = operations
  }

  init(_ patch: Patch) {
    self.init(
      hash: patch.hash,
      operations: patch.operations
    )
  }
}

struct BlendParameters: Sendable, Equatable {
  let compositeOp: CompositeOp
  let blendMode: BlendMode
  let opacity: UInt8
}

struct StoredChunkState: Sendable {
  let patches: [PatchSummary]
}

/// A disposable raster cache keyed by the complete event set for one chunk.
struct CachedChunkSnapshot: Sendable {
  let snapshot: ChunkSnapshot
  let stateHash: String
}

protocol ChunkStore: Sendable {
  func load() throws -> StoredChunkState
  /// Returns the full patch (including operation images) by hash, or `nil` when
  /// the store has no such patch.
  func patch(hash: String) throws -> Patch?
  func snapshot(x: Int32, y: Int32, stateHash: String) throws -> Data?
  /// Persists the immutable Patch as soon as its DAG references are known to be valid.
  func storePatch(_ patch: Patch) throws
  func storeSnapshots(_ snapshots: [CachedChunkSnapshot]) throws
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
  func snapshot(x: Int32, y: Int32, stateHash: String) throws -> Data? { nil }
  func storeSnapshots(_ snapshots: [CachedChunkSnapshot]) throws {}

  func storePatch(_ patch: Patch) throws {
    if patches[patch.hash] == nil { order.append(patch.hash) }
    patches[patch.hash] = patch
  }
}

/// Stores immutable Patch files as the source of truth and PNG snapshots as a disposable cache.
final class FileSystemChunkStore: ChunkStore, @unchecked Sendable {
  private let snapshotDirectory: URL
  private let patchesDirectory: URL
  private let fileManager = FileManager.default

  init(storageDirectory: URL) throws {
    patchesDirectory = storageDirectory.appending(path: "patches", directoryHint: .isDirectory)
    snapshotDirectory = storageDirectory.appending(path: "snapshots", directoryHint: .isDirectory)
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

  func snapshot(x: Int32, y: Int32, stateHash: String) throws -> Data? {
    let url = snapshotURL(x: x, y: y, stateHash: stateHash)
    guard fileManager.fileExists(atPath: url.path) else { return nil }
    return try Data(contentsOf: url, options: .mappedIfSafe)
  }

  func storeSnapshots(_ snapshots: [CachedChunkSnapshot]) throws {
    for cached in snapshots {
      let snapshot = cached.snapshot
      let directory = snapshotDirectory
        .appending(path: String(snapshot.chunk.x), directoryHint: .isDirectory)
        .appending(path: String(snapshot.chunk.y), directoryHint: .isDirectory)
      try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
      try snapshot.imageBytes.write(
        to: snapshotURL(x: snapshot.chunk.x, y: snapshot.chunk.y, stateHash: cached.stateHash),
        options: .atomic
      )
      let currentFileName = "\(cached.stateHash).png"
      for url in try fileManager.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: nil
      ) where url.pathExtension == "png" && url.lastPathComponent != currentFileName {
        try fileManager.removeItem(at: url)
      }
    }
  }

  func storePatch(_ patch: Patch) throws {
    try PatchPacketCodec.encode(patch).write(
      to: patchesDirectory.appending(path: "\(patch.hash).patch"),
      options: .atomic
    )
  }

  private func snapshotURL(x: Int32, y: Int32, stateHash: String) -> URL {
    snapshotDirectory
      .appending(path: String(x), directoryHint: .isDirectory)
      .appending(path: String(y), directoryHint: .isDirectory)
      .appending(path: "\(stateHash).png")
  }
}
