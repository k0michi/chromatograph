import Foundation

struct TileChunk: Equatable, Sendable {
    let x: Int32
    let y: Int32
}

enum CompositeOp: UInt32, Equatable, Sendable {
    case sourceOver = 0
    case destinationOut = 1
    case sourceIn = 2
    case sourceAtop = 3
}

enum BlendMode: UInt32, Equatable, Sendable {
    case normal = 0
    case multiply = 1
    case screen = 2
    case overlay = 3
}

struct BlendOperation: Equatable, Sendable {
    let chunk: TileChunk
    let parents: [String]
    let compositeOp: CompositeOp
    let blendMode: BlendMode
    let opacity: Float
    let imageBytes: Data
}

struct UndoOperation: Equatable, Sendable {
    let chunk: TileChunk
    let parents: [String]
}

enum Operation: Equatable, Sendable {
    case blend(BlendOperation)
    case undo(UndoOperation)
}

struct Patch: Equatable, Sendable {
    let operations: [Operation]
    let publicKeyHex: String
    let hash: String
    let signatureHex: String
}
