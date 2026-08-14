import Foundation

enum ChunkManagerError: Error, Equatable {
  case duplicatePatch(String)
  case duplicateChunk(TileChunk)
  case duplicateParent(String)
  case missingParent(String, TileChunk)
  case selfParent(String, TileChunk)
  case cycle(String)
  case invalidUndoParents(String)
}

actor ChunkManager {
  static let tileSize = 256

  private struct Entry {
    let patchHash: String
    let operation: Operation
  }

  private var entriesByChunk: [TileChunkKey: [Entry]] = [:]
  private var snapshots: [TileChunkKey: [UInt8]] = [:]
  private var committedHashes: Set<String> = []
  private var patchesByHash: [String: Patch] = [:]
  private let store: any ChunkStore
  private var isLoaded = false

  init(store: any ChunkStore = MemoryChunkStore()) {
    self.store = store
  }

  /// Validates and applies every operation in a patch as one transaction.
  /// No DAG or snapshot state is changed unless all affected chunks render successfully.
  func apply(_ patch: Patch) throws -> [ChunkSnapshot] {
    try loadIfNeeded()
    guard !committedHashes.contains(patch.hash) else {
      throw ChunkManagerError.duplicatePatch(patch.hash)
    }

    try validate(patch)

    var touched: Set<TileChunkKey> = []
    var candidateEntries = entriesByChunk
    for operation in patch.operations {
      let key = TileChunkKey(operation.chunk)
      candidateEntries[key, default: []].append(Entry(patchHash: patch.hash, operation: operation))
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
      snapshots[key] = snapshot
    }
    committedHashes.insert(patch.hash)
    patchesByHash[patch.hash] = patch
    return encodedSnapshots
  }

  func snapshot(x: Int32, y: Int32) -> [UInt8]? {
    snapshots[TileChunkKey(x: x, y: y)]
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
      if case .blend = entry.operation { return indexByHash[entry.patchHash] }
      var next = visiting
      next.insert(entry.patchHash)
      return try entry.operation.parents.compactMap { parent in
        guard let index = indexByHash[parent] else { return nil }
        return try blendDependencyIndex(ordered[index], visiting: next)
      }.min()
    }

    var replayIndex = requestedIndex
    var changed = true
    while changed {
      changed = false
      for entry in ordered[replayIndex...] where entry.operation.isUndo {
        if let dependency = try blendDependencyIndex(entry), dependency < replayIndex {
          replayIndex = dependency
          changed = true
          break
        }
      }
    }

    let base = try render(Array(ordered[..<replayIndex]))
    let patches = ordered[replayIndex...].compactMap { entry -> Patch? in
      guard let patch = patchesByHash[entry.patchHash] else { return nil }
      return Patch(
        operations: [entry.operation],
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
    return try Set(chunks.map(TileChunkKey.init)).sorted().compactMap { key in
      guard let rgba = snapshots[key], let entries = entriesByChunk[key] else { return nil }
      guard let head = try linearize(entries).last?.patchHash else { return nil }
      return ChunkSnapshot(
        chunk: .init(x: key.x, y: key.y),
        headPatchHash: head,
        imageBytes: try PNGCodec.encodeRGBA8(rgba, width: Self.tileSize, height: Self.tileSize)
      )
    }
  }

  private func loadIfNeeded() throws {
    guard !isLoaded else { return }
    let state = try store.load()
    var restoredEntries: [TileChunkKey: [Entry]] = [:]
    for patch in state.patches {
      for operation in patch.operations {
        restoredEntries[TileChunkKey(operation.chunk), default: []].append(
          Entry(patchHash: patch.hash, operation: operation)
        )
      }
      committedHashes.insert(patch.hash)
      patchesByHash[patch.hash] = patch
    }
    var restoredSnapshots: [TileChunkKey: [UInt8]] = [:]
    for (key, entries) in restoredEntries {
      let head = try linearize(entries).last?.patchHash
      if let head, let snapshot = try store.snapshot(x: key.x, y: key.y, headPatchHash: head) {
        restoredSnapshots[key] = try PNGCodec.decode(snapshot).rgba
      } else {
        restoredSnapshots[key] = try render(entries)
      }
    }
    entriesByChunk = restoredEntries
    snapshots = restoredSnapshots
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
      guard case .blend(let operation) = entry.operation else { continue }
      let source = try PNGCodec.decode(operation.imageBytes).rgba
      try Compositor.blend(
        source: source,
        onto: &rgba,
        opacity: operation.opacity,
        compositeOp: operation.compositeOp,
        blendMode: operation.blendMode
      )
    }
    return rgba
  }

  private func linearize(_ entries: [Entry]) throws -> [Entry] {
    let hashes = Set(entries.map(\.patchHash))
    var children: [String: [Entry]] = [:]
    var parentCount: [String: Int] = [:]
    for entry in entries {
      let parents = entry.operation.parents.filter { hashes.contains($0) }
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
      let parents = entry.operation.parents.filter { hashes.contains($0) }
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
      if case .blend = entry.operation {
        return UndoSubject(blendHashes: [hash], visible: true)
      }
      var nextVisiting = visiting
      nextVisiting.insert(hash)
      let subjects = try entry.operation.parents.compactMap {
        try resolveUndoSubject($0, visiting: nextVisiting)
      }
      guard let first = subjects.first else { return nil }
      guard subjects.dropFirst().allSatisfy({ $0 == first }) else {
        throw ChunkManagerError.invalidUndoParents(hash)
      }
      return UndoSubject(blendHashes: first.blendHashes, visible: !first.visible)
    }

    for entry in entries where entry.operation.isUndo {
      let subjects = try entry.operation.parents.compactMap {
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
      let undoChildren = (children[hash] ?? []).filter(\.operation.isUndo)
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
      guard case .blend = entry.operation else { return false }
      return try isActive(entry.patchHash)
    }
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
}
