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

private func validatePatchImages(_ patch: Patch) throws {
    for operation in patch.operations {
        guard case .blend(let blend) = operation else { continue }
        try PNGValidator.validateRGBA8(
            blend.imageBytes,
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
    let router = try buildRouter()
    let wsRouter = try buildWebSocketRouter(broadcaster: PatchBroadcaster())
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
func buildRouter() throws -> Router<AppRequestContext> {
    let router = Router(context: AppRequestContext.self)
    // Add middleware
    router.addMiddleware {
        // logging middleware
        LogRequestsMiddleware(.info)
    }
    // Add default endpoint
    router.get("/") { _, _ in
        return "Hello!"
    }
    return router
}

/// Build websocket router
func buildWebSocketRouter(broadcaster: PatchBroadcaster) throws -> Router<AppWSRequestContext> {
    let router = Router(context: AppWSRequestContext.self)
    // Add middleware
    router.addMiddleware {
        // logging middleware
        LogRequestsMiddleware(.info)
    }
    router.ws("/ws") { _, _ in
        return .upgrade()
    } onUpgrade: { inbound, outbound, _ in
        let connectionID = try await broadcaster.synchronize(outbound)
        do {
            for try await message in inbound.messages(maxSize: maximumPatchPacketSize) {
                switch message {
                case .binary(let buffer):
                    do {
                        let patch = try PatchPacketCodec.decode(Data(buffer.readableBytesView))
                        try validatePatchImages(patch)
                        await broadcaster.accept(patch, packet: buffer)
                    } catch {
                        try await outbound.write(.text("Invalid patch packet"))
                    }
                case .text:
                    try await outbound.write(.text("Patch packets must be binary"))
                }
            }
        } catch {
            await broadcaster.remove(connectionID)
            throw error
        }
        await broadcaster.remove(connectionID)
    }
    return router
}
