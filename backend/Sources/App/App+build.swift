import Configuration
import Hummingbird
import HummingbirdWebSocket
import Logging

// Request context used by application
typealias AppRequestContext = BasicRequestContext
typealias AppWSRequestContext = BasicWebSocketRequestContext

///  Build application
/// - Parameter reader: configuration reader
func buildApplication(reader: ConfigReader) async throws -> some ApplicationProtocol {
    let logger = {
        var logger = Logger(label: "ChromatographBackend")
        logger.logLevel = reader.string(forKey: "log.level", as: Logger.Level.self, default: .info)
        return logger
    }()
    let router = try buildRouter()
    let wsRouter = try buildWebSocketRouter()
    let app = Application(
        router: router,
        server: .http1WebSocketUpgrade(webSocketRouter: wsRouter),
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
func buildWebSocketRouter() throws -> Router<AppWSRequestContext> {
    let router = Router(context: AppWSRequestContext.self)
    // Add middleware
    router.addMiddleware {
        // logging middleware
        LogRequestsMiddleware(.info)
    }
    // Add default endpoint
    router.ws("/ws") { request, context in
        return .upgrade()
    } onUpgrade: { inbound, outbound, context in
        // Read inbound message
        for try await message in inbound.messages(maxSize: 1_000_000) {
            // write type and size of message
            switch message {
            case .binary(let buffer):
                try await outbound.write(.text("Binary message, length: \(buffer.readableBytes)"))
            case .text(let string):
                try await outbound.write(.text("Text message, length: \(string.count)"))
            }
        }
    }
    return router
}
