import Logging

/// Coalesces affected chunk coordinates and computes their disposable snapshots
/// outside the Patch upload request. A chunk queued again while a calculation is
/// running is processed once more, so the final broadcast always catches up.
actor SnapshotQueue {
  private let chunks: ChunkManager
  private let broadcaster: PatchBroadcaster
  private let logger: Logger
  private var pending: Set<TileChunkKey> = []
  private var isProcessing = false
  private var idleWaiters: [CheckedContinuation<Void, Never>] = []

  init(chunks: ChunkManager, broadcaster: PatchBroadcaster, logger: Logger) {
    self.chunks = chunks
    self.broadcaster = broadcaster
    self.logger = logger
  }

  func enqueue(_ coordinates: [TileChunk]) {
    pending.formUnion(coordinates.map(TileChunkKey.init))
    guard !isProcessing else { return }
    isProcessing = true
    Task { await drain() }
  }

  func waitUntilIdle() async {
    guard isProcessing else { return }
    await withCheckedContinuation { idleWaiters.append($0) }
  }

  private func drain() async {
    while !pending.isEmpty {
      let batch = pending.sorted().map { TileChunk(x: $0.x, y: $0.y) }
      pending.removeAll()
      do {
        let snapshots = try await chunks.latestSnapshots(for: batch)
        if !snapshots.isEmpty {
          try await broadcaster.broadcast(snapshots: snapshots)
        }
      } catch {
        logger.error("Snapshot calculation failed", metadata: [
          "error": "\(error)",
          "chunks": "\(batch.map { "\($0.x),\($0.y)" }.joined(separator: ";"))",
        ])
      }
    }
    isProcessing = false
    for waiter in idleWaiters { waiter.resume() }
    idleWaiters.removeAll()
  }
}
