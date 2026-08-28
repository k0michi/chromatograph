import Foundation

enum ChunkManagerError: Error, Equatable {
  case duplicatePatch(String)
  case duplicateChunk(TileChunk)
  case duplicateParent(String)
  case missingParent(String, TileChunk)
  case selfParent(String, TileChunk)
  case cycle(String)
  case invalidUndoParents(String)
  case missingPatchPayload(String)
}

actor ChunkManager {
  static let tileSize = 256

  /// One node of a chunk's operation DAG. Deliberately payload-free: the blend
  /// image lives in the `ChunkStore` and is pulled in only when a render needs
  /// it, so per-chunk history costs a few hundred bytes instead of a PNG each.
  private struct Entry {
    let patchHash: String
    let chunk: TileChunk
    let parents: [String]
    /// `nil` for an undo operation.
    let blend: BlendParameters?

    var isUndo: Bool { blend == nil }
    var isBlend: Bool { blend != nil }
  }

  private var entriesByChunk: [TileChunkKey: [Entry]] = [:]
  /// Hot, bounded cache of rasterized (RGBA8) chunk snapshots. Each raster is
  /// ~256 KiB, so a per-chunk map grows without bound as the canvas expands.
  /// The authoritative copies are PNGs in the `ChunkStore`; this only keeps the
  /// working set resident so repeated reads do not re-decode or re-render.
  private var snapshotCache: LRUCache<TileChunkKey, [UInt8]>
  /// Hot, bounded cache of full patches (with images) fetched from the store,
  /// so a render or replay that revisits the same operation avoids re-reading
  /// and re-parsing the patch file.
  private var patchCache: LRUCache<String, Patch>
  private var headPatchHashes: [TileChunkKey: String] = [:]
  private var committedHashes: Set<String> = []
  private let store: any ChunkStore
  private var isLoaded = false

  init(
    store: any ChunkStore = MemoryChunkStore(),
    hotSnapshotCapacity: Int = 32,
    hotPatchCapacity: Int = 64
  ) {
    self.store = store
    self.snapshotCache = LRUCache(capacity: hotSnapshotCapacity)
    self.patchCache = LRUCache(capacity: hotPatchCapacity)
  }

  /// Validates and applies every operation in a patch as one transaction.
  /// No DAG or snapshot state is changed unless all affected chunks render successfully.
  func apply(_ patch: Patch) throws -> [ChunkSnapshot] {
    try loadIfNeeded()
    guard !committedHashes.contains(patch.hash) else {
      throw ChunkManagerError.duplicatePatch(patch.hash)
    }

    try validate(patch)

    // Prime the cache so the render below can resolve this patch's own images
    // before it is written to the store.
    patchCache.set(patch.hash, patch)

    var touched: Set<TileChunkKey> = []
    var candidateEntries = entriesByChunk
    for operation in patch.operations {
      let key = TileChunkKey(operation.chunk)
      candidateEntries[key, default: []].append(Entry(
        patchHash: patch.hash,
        chunk: operation.chunk,
        parents: operation.parents,
        blend: operation.blendParameters
      ))
      touched.insert(key)
    }
    var candidateSnapshots: [TileChunkKey: [UInt8]] = [:]
    for key in touched {
      candidateSnapshots[key] = try render(candidateEntries[key] ?? [])
    }
    let encodedSnapshots = try touched.sorted().map { key in
      let head = try linearize(candidateEntries[key] ?? []).last?.patchHash ?? patch.hash
      return ChunkSnapshot(
        chunk: TileChunk(x: key.x, y: key.y),
        headPatchHash: head,
        imageBytes: try PNGCodec.encodeRGBA8(
          candidateSnapshots[key]!,
          width: Self.tileSize,
          height: Self.tileSize
        )
      )
    }
    try store.commit(patch: patch, snapshots: encodedSnapshots)
    entriesByChunk = candidateEntries
    for (key, snapshot) in candidateSnapshots {
      snapshotCache.set(key, snapshot)
    }
    for snapshot in encodedSnapshots {
      headPatchHashes[TileChunkKey(snapshot.chunk)] = snapshot.headPatchHash
    }
    committedHashes.insert(patch.hash)
    return encodedSnapshots
  }

  func snapshot(x: Int32, y: Int32) throws -> [UInt8]? {
    try loadIfNeeded()
    return try rasterizedSnapshot(for: TileChunkKey(x: x, y: y))
  }

  /// Resolves a chunk's RGBA8 raster from, in order: the hot cache, the on-disk
  /// PNG snapshot, or a fresh render of the chunk's operation history. Returns
  /// `nil` for chunks that have never been drawn on. The result is cached.
  private func rasterizedSnapshot(for key: TileChunkKey) throws -> [UInt8]? {
    if let cached = snapshotCache.get(key) { return cached }
    guard let entries = entriesByChunk[key], !entries.isEmpty else { return nil }
    if let head = headPatchHashes[key],
      let png = try store.snapshot(x: key.x, y: key.y, headPatchHash: head)
    {
      let rgba = try PNGCodec.decode(png).rgba
      snapshotCache.set(key, rgba)
      return rgba
    }
    let rgba = try render(entries)
    snapshotCache.set(key, rgba)
    return rgba
  }

  /// Returns a client-side replay base and every partial Patch after that base.
  /// Undo requires replaying from its target Blend, because Undo has no pixel payload.
  func replay(x: Int32, y: Int32, from patchHash: String) throws -> ChunkReplay {
    try loadIfNeeded()
    let chunk = TileChunk(x: x, y: y)
    let entries = entriesByChunk[TileChunkKey(x: x, y: y)] ?? []
    let ordered = try linearize(entries)
    guard let requestedIndex = ordered.firstIndex(where: { $0.patchHash == patchHash }) else {
      throw ChunkManagerError.missingParent(patchHash, chunk)
    }

    let indexByHash = Dictionary(uniqueKeysWithValues: ordered.enumerated().map { ($0.element.patchHash, $0.offset) })
    func blendDependencyIndex(_ entry: Entry, visiting: Set<String> = []) throws -> Int? {
      guard !visiting.contains(entry.patchHash) else { throw ChunkManagerError.cycle(entry.patchHash) }
      if entry.isBlend { return indexByHash[entry.patchHash] }
      var next = visiting
      next.insert(entry.patchHash)
      return try entry.parents.compactMap { parent in
        guard let index = indexByHash[parent] else { return nil }
        return try blendDependencyIndex(ordered[index], visiting: next)
      }.min()
    }

    var replayIndex = requestedIndex
    var changed = true
    while changed {
      changed = false
      for entry in ordered[replayIndex...] where entry.isUndo {
        if let dependency = try blendDependencyIndex(entry), dependency < replayIndex {
          replayIndex = dependency
          changed = true
          break
        }
      }
    }

    let base = try render(Array(ordered[..<replayIndex]))
    let patches = try ordered[replayIndex...].compactMap { entry -> Patch? in
      guard let patch = try loadPatch(entry.patchHash) else { return nil }
      guard let operation = patch.operations.first(where: { $0.chunk == entry.chunk }) else {
        return nil
      }
      return Patch(
        operations: [operation],
        publicKeyHex: patch.publicKeyHex,
        hash: patch.hash,
        signatureHex: patch.signatureHex
      )
    }
    return ChunkReplay(
      containsEntireOrder: replayIndex == 0,
      imageBytes: try PNGCodec.encodeRGBA8(base, width: Self.tileSize, height: Self.tileSize),
      patches: patches
    )
  }

  func latestSnapshots(for chunks: [TileChunk]) throws -> [ChunkSnapshot] {
    try loadIfNeeded()
    var result: [ChunkSnapshot] = []
    var generated: [ChunkSnapshot] = []
    for key in Set(chunks.map(TileChunkKey.init)).sorted() {
      guard let head = headPatchHashes[key] else { continue }
      if let cached = try store.snapshot(x: key.x, y: key.y, headPatchHash: head) {
        result.append(ChunkSnapshot(
          chunk: .init(x: key.x, y: key.y),
          headPatchHash: head,
          imageBytes: cached
        ))
        continue
      }
      guard let rgba = try rasterizedSnapshot(for: key) else { continue }
      let snapshot = ChunkSnapshot(
        chunk: .init(x: key.x, y: key.y),
        headPatchHash: head,
        imageBytes: try PNGCodec.encodeRGBA8(rgba, width: Self.tileSize, height: Self.tileSize)
      )
      result.append(snapshot)
      generated.append(snapshot)
    }
    if !generated.isEmpty { try store.storeSnapshots(generated) }
    return result
  }

  private func loadIfNeeded() throws {
    guard !isLoaded else { return }
    let state = try store.load()
    var restoredEntries: [TileChunkKey: [Entry]] = [:]
    for patch in state.patches {
      for operation in patch.operations {
        restoredEntries[TileChunkKey(operation.chunk), default: []].append(
          Entry(
            patchHash: patch.hash,
            chunk: operation.chunk,
            parents: operation.parents,
            blend: operation.blend
          )
        )
      }
      committedHashes.insert(patch.hash)
    }
    // Only the payload-free DAG index is restored eagerly. Operation images and
    // rasters are pulled from the store lazily on first render/read, so restoring
    // a large canvas never holds every chunk's pixels in memory at once.
    var restoredHeadPatchHashes: [TileChunkKey: String] = [:]
    for (key, entries) in restoredEntries {
      if let head = try linearize(entries).last?.patchHash {
        restoredHeadPatchHashes[key] = head
      }
    }
    entriesByChunk = restoredEntries
    headPatchHashes = restoredHeadPatchHashes
    isLoaded = true
  }

  private func validate(_ patch: Patch) throws {
    var chunks: Set<TileChunkKey> = []

    for operation in patch.operations {
      let chunk = operation.chunk
      let key = TileChunkKey(chunk)
      guard chunks.insert(key).inserted else {
        throw ChunkManagerError.duplicateChunk(chunk)
      }

      var parents: Set<String> = []
      for parent in operation.parents {
        guard parents.insert(parent).inserted else {
          throw ChunkManagerError.duplicateParent(parent)
        }
        guard parent != patch.hash else {
          throw ChunkManagerError.selfParent(parent, chunk)
        }
        guard entriesByChunk[key]?.contains(where: { $0.patchHash == parent }) == true else {
          throw ChunkManagerError.missingParent(parent, chunk)
        }
      }
    }
  }

  private func render(_ entries: [Entry]) throws -> [UInt8] {
    var rgba = [UInt8](repeating: 0, count: Self.tileSize * Self.tileSize * 4)
    for entry in try resolveActiveBlendEntries(entries) {
      guard let blend = entry.blend else { continue }
      guard let imageBytes = try blendImage(patchHash: entry.patchHash, chunk: entry.chunk) else {
        throw ChunkManagerError.missingPatchPayload(entry.patchHash)
      }
      let source = try PNGCodec.decode(imageBytes).rgba
      try Compositor.blend(
        source: source,
        onto: &rgba,
        opacity: blend.opacity,
        compositeOp: blend.compositeOp,
        blendMode: blend.blendMode
      )
    }
    return rgba
  }

  /// Fetches the full patch for `hash`, preferring the hot cache over the store.
  private func loadPatch(_ hash: String) throws -> Patch? {
    if let cached = patchCache.get(hash) { return cached }
    guard let patch = try store.patch(hash: hash) else { return nil }
    patchCache.set(hash, patch)
    return patch
  }

  /// The RGBA8 PNG bytes of the blend operation `patchHash` contributed to `chunk`.
  private func blendImage(patchHash: String, chunk: TileChunk) throws -> Data? {
    guard let patch = try loadPatch(patchHash) else { return nil }
    for operation in patch.operations {
      if case .blend(let blend) = operation, blend.chunk == chunk { return blend.imageBytes }
    }
    return nil
  }

  private func linearize(_ entries: [Entry]) throws -> [Entry] {
    let hashes = Set(entries.map(\.patchHash))
    var children: [String: [Entry]] = [:]
    var parentCount: [String: Int] = [:]
    for entry in entries {
      let parents = entry.parents.filter { hashes.contains($0) }
      parentCount[entry.patchHash] = parents.count
      for parent in parents { children[parent, default: []].append(entry) }
    }
    var ordered: [Entry] = []
    var visited: Set<String> = []
    func visit(_ entry: Entry) {
      guard visited.insert(entry.patchHash).inserted else { return }
      ordered.append(entry)
      for child in (children[entry.patchHash] ?? []).sorted(by: { $0.patchHash < $1.patchHash }) { visit(child) }
    }
    for root in entries.filter({ parentCount[$0.patchHash] == 0 }).sorted(by: { $0.patchHash < $1.patchHash }) { visit(root) }
    guard visited.count == entries.count else { throw ChunkManagerError.cycle("unknown") }
    return ordered
  }

  /// Resolves README sections 6.2 and 6.3 using the same rules as the frontend.
  private func resolveActiveBlendEntries(_ entries: [Entry]) throws -> [Entry] {
    var byHash: [String: Entry] = [:]
    for entry in entries { byHash[entry.patchHash] = entry }
    let hashes = Set(byHash.keys)
    var children: [String: [Entry]] = [:]
    var parentCount: [String: Int] = [:]
    for entry in entries {
      let parents = entry.parents.filter { hashes.contains($0) }
      parentCount[entry.patchHash] = parents.count
      for parent in parents {
        children[parent, default: []].append(entry)
      }
    }

    struct UndoSubject: Equatable {
      let blendHashes: [String]
      let visible: Bool
    }
    func resolveUndoSubject(
      _ hash: String,
      visiting: Set<String> = []
    ) throws -> UndoSubject? {
      guard !visiting.contains(hash) else { throw ChunkManagerError.cycle(hash) }
      guard let entry = byHash[hash] else { return nil }
      if entry.isBlend {
        return UndoSubject(blendHashes: [hash], visible: true)
      }
      var nextVisiting = visiting
      nextVisiting.insert(hash)
      let subjects = try entry.parents.compactMap {
        try resolveUndoSubject($0, visiting: nextVisiting)
      }
      guard let first = subjects.first else { return nil }
      guard subjects.dropFirst().allSatisfy({ $0 == first }) else {
        throw ChunkManagerError.invalidUndoParents(hash)
      }
      return UndoSubject(blendHashes: first.blendHashes, visible: !first.visible)
    }

    for entry in entries where entry.isUndo {
      let subjects = try entry.parents.compactMap {
        try resolveUndoSubject($0)
      }
      guard let first = subjects.first else { continue }
      guard subjects.dropFirst().allSatisfy({ $0 == first }) else {
        throw ChunkManagerError.invalidUndoParents(entry.patchHash)
      }
    }

    struct UndoChain {
      let maximumHash: String
      let length: Int
    }
    func chainsFrom(
      _ hash: String,
      maximumHash: String,
      length: Int,
      visiting: Set<String>
    ) throws -> [UndoChain] {
      guard !visiting.contains(hash) else { throw ChunkManagerError.cycle(hash) }
      let undoChildren = (children[hash] ?? []).filter(\.isUndo)
      guard !undoChildren.isEmpty else {
        return [UndoChain(maximumHash: maximumHash, length: length)]
      }
      var nextVisiting = visiting
      nextVisiting.insert(hash)
      return try undoChildren.flatMap { entry in
        try chainsFrom(
          entry.patchHash,
          maximumHash: max(maximumHash, entry.patchHash),
          length: length + 1,
          visiting: nextVisiting
        )
      }
    }
    func isActive(_ blendHash: String) throws -> Bool {
      let chains = try chainsFrom(blendHash, maximumHash: "", length: 0, visiting: [])
      let winner = chains.max { $0.maximumHash < $1.maximumHash }!
      return winner.length.isMultiple(of: 2)
    }

    var ordered: [Entry] = []
    var visited: Set<String> = []
    func visit(_ entry: Entry) {
      guard visited.insert(entry.patchHash).inserted else { return }
      ordered.append(entry)
      for child in (children[entry.patchHash] ?? []).sorted(by: { $0.patchHash < $1.patchHash }) {
        visit(child)
      }
    }
    for root in entries.filter({ parentCount[$0.patchHash] == 0 }).sorted(by: {
      $0.patchHash < $1.patchHash
    }) {
      visit(root)
    }
    guard visited.count == entries.count else { throw ChunkManagerError.cycle("unknown") }
    return try ordered.filter { entry in
      guard entry.isBlend else { return false }
      return try isActive(entry.patchHash)
    }
  }
}

/// Fixed-capacity most-recently-used cache. Inserting beyond `capacity` evicts
/// the least recently used entry. All access is serialized by the owning
/// `ChunkManager` actor, so there is no internal locking. `capacity` is small,
/// so the O(capacity) recency scan on each access is negligible.
private struct LRUCache<Key: Hashable, Value> {
  private let capacity: Int
  private var storage: [Key: Value] = [:]
  /// Keys ordered least- to most-recently used.
  private var recency: [Key] = []

  init(capacity: Int) {
    self.capacity = max(1, capacity)
  }

  mutating func get(_ key: Key) -> Value? {
    guard let value = storage[key] else { return nil }
    touch(key)
    return value
  }

  mutating func set(_ key: Key, _ value: Value) {
    storage[key] = value
    touch(key)
    while recency.count > capacity {
      storage[recency.removeFirst()] = nil
    }
  }

  private mutating func touch(_ key: Key) {
    if let index = recency.firstIndex(of: key) { recency.remove(at: index) }
    recency.append(key)
  }
}

private struct TileChunkKey: Hashable, Comparable {
  let x: Int32
  let y: Int32

  init(x: Int32, y: Int32) {
    self.x = x
    self.y = y
  }

  init(_ chunk: TileChunk) {
    self.init(x: chunk.x, y: chunk.y)
  }

  static func < (lhs: Self, rhs: Self) -> Bool {
    lhs.x == rhs.x ? lhs.y < rhs.y : lhs.x < rhs.x
  }
}

extension Operation {
  fileprivate var chunk: TileChunk {
    switch self {
    case .blend(let operation): operation.chunk
    case .undo(let operation): operation.chunk
    }
  }

  fileprivate var parents: [String] {
    switch self {
    case .blend(let operation): operation.parents
    case .undo(let operation): operation.parents
    }
  }

  fileprivate var isUndo: Bool {
    if case .undo = self { return true }
    return false
  }

  fileprivate var blendParameters: BlendParameters? {
    guard case .blend(let operation) = self else { return nil }
    return BlendParameters(
      compositeOp: operation.compositeOp,
      blendMode: operation.blendMode,
      opacity: operation.opacity
    )
  }
}
