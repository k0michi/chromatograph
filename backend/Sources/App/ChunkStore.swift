import Foundation

struct StoredChunkState: Sendable {
  let patches: [Patch]
}

protocol ChunkStore: Sendable {
  func load() throws -> StoredChunkState
  func snapshot(x: Int32, y: Int32, headPatchHash: String) throws -> Data?
  func commit(patch: Patch, snapshots: [ChunkSnapshot]) throws
}

struct MemoryChunkStore: ChunkStore {
  func load() throws -> StoredChunkState { .init(patches: []) }
  func snapshot(x: Int32, y: Int32, headPatchHash: String) throws -> Data? { nil }
  func commit(patch: Patch, snapshots: [ChunkSnapshot]) throws {}
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
    let patches = try patchURLs.map { try PatchPacketCodec.decode(Data(contentsOf: $0)) }
    return .init(patches: patches)
  }

  func snapshot(x: Int32, y: Int32, headPatchHash: String) throws -> Data? {
    let url = snapshotURL(x: x, y: y, headPatchHash: headPatchHash)
    guard fileManager.fileExists(atPath: url.path) else { return nil }
    return try Data(contentsOf: url)
  }

  func commit(patch: Patch, snapshots: [ChunkSnapshot]) throws {
    // Snapshot files are written first. The atomic Patch write is the commit point;
    // snapshots left by an interrupted write are harmless cache entries.
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
