import Configuration
import Foundation
import Hummingbird
import HummingbirdWebSocket
import Logging

// Request context used by application
typealias AppRequestContext = BasicRequestContext
typealias AppWSRequestContext = BasicWebSocketRequestContext
private let maximumPatchPacketSize = 64 * 1024 * 1024
private let patchImageSize = 256

private struct SnapshotRequest: Decodable {
  struct Chunk: Decodable {
    let x: Int32
    let y: Int32
  }

  let chunks: [Chunk]
}

private func validatePatchImages(_ patch: Patch) throws {
  for image in patch.images {
    try PNGValidator.validateRGBA8(
      image,
      width: patchImageSize,
      height: patchImageSize
    )
  }
}

///  Build application
/// - Parameter reader: configuration reader
func buildApplication(reader: ConfigReader) async throws -> some ApplicationProtocol {
  let logger = {
    var logger = Logger(label: "ChromatographBackend")
    logger.logLevel = reader.string(forKey: "log.level", as: Logger.Level.self, default: .info)
    return logger
  }()
  let storagePath = reader.string(forKey: "storage.path", default: "")
  let store: any ChunkStore
  if storagePath.isEmpty {
    store = MemoryChunkStore()
  } else {
    store = try FileSystemChunkStore(
      storageDirectory: URL(filePath: storagePath, directoryHint: .isDirectory)
    )
  }
  let broadcaster = PatchBroadcaster(store: store)
  let router = try buildRouter(broadcaster: broadcaster)
  let wsRouter = try buildWebSocketRouter(broadcaster: broadcaster)
  let app = Application(
    router: router,
    server: .http1WebSocketUpgrade(
      webSocketRouter: wsRouter,
      configuration: .init(ws: .init(maxFrameSize: maximumPatchPacketSize))
    ),
    configuration: ApplicationConfiguration(reader: reader.scoped(to: "http")),
    logger: logger
  )
  return app
}

/// Build router
func buildRouter(broadcaster: PatchBroadcaster) throws -> Router<AppRequestContext> {
  let router = Router(context: AppRequestContext.self)
  router.addMiddleware {
    LogRequestsMiddleware(.info)
  }
  router.get("/api/chunks/:x/:y/replay") { request, context -> Response in
    guard
      let x = context.parameters.get("x", as: Int32.self),
      let y = context.parameters.get("y", as: Int32.self),
      let from = request.uri.queryParameters["from"].map(String.init)
    else { throw HTTPError(.badRequest) }
    do {
      let data = try await broadcaster.replay(x: x, y: y, from: from)
      return Response(
        status: .ok,
        headers: [.contentType: "application/octet-stream"],
        body: .init(byteBuffer: ByteBuffer(bytes: data))
      )
    } catch ChunkManagerError.missingParent {
      throw HTTPError(.notFound)
    }
  }
  router.post("/api/snapshots") { request, context -> Response in
    let snapshotRequest = try await context.requestDecoder.decode(
      SnapshotRequest.self,
      from: request,
      context: context
    )
    let chunks = snapshotRequest.chunks.map { TileChunk(x: $0.x, y: $0.y) }
    let data = try await broadcaster.snapshots(chunks: chunks)
    return Response(
      status: .ok,
      headers: [.contentType: "application/octet-stream"],
      body: .init(byteBuffer: ByteBuffer(bytes: data))
    )
  }
  router.post("/api/patches") { request, _ -> Response in
    let body: ByteBuffer
    do {
      body = try await request.body.collect(upTo: maximumPatchPacketSize)
    } catch {
      throw HTTPError(.contentTooLarge)
    }
    let patch: Patch
    do {
      patch = try PatchPacketCodec.decode(Data(body.readableBytesView))
      try PatchValidator.validate(patch)
      try validatePatchImages(patch)
    } catch {
      throw HTTPError(.badRequest)
    }
    do {
      switch try await broadcaster.accept(patch) {
      case .created:
        return Response(status: .created)
      case .alreadyExists:
        return Response(status: .ok)
      }
    } catch is ChunkManagerError {
      // The packet is structurally valid, but cannot be applied to the current DAG.
      throw HTTPError(.unprocessableContent)
    }
  }
  return router
}

/// Build websocket router
func buildWebSocketRouter(broadcaster: PatchBroadcaster) throws -> Router<AppWSRequestContext> {
  let router = Router(context: AppWSRequestContext.self)
  router.addMiddleware {
    LogRequestsMiddleware(.info)
  }
  router.ws("/ws") { _, _ in
    return .upgrade()
  } onUpgrade: { inbound, outbound, _ in
    let connectionID = await broadcaster.addConnection(outbound)
    do {
      for try await message in inbound.messages(maxSize: maximumPatchPacketSize) {
        _ = message
        try await outbound.write(.text("Patch uploads require POST /api/patches"))
      }
    } catch {
      await broadcaster.remove(connectionID)
      throw error
    }
    await broadcaster.remove(connectionID)
  }
  return router
}
