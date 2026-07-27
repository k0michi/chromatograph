import Configuration
import Hummingbird
import HummingbirdTesting
import HummingbirdWSTesting
import Logging
import Testing

@testable import ChromatographBackend

private let reader = ConfigReader(providers: [
    InMemoryProvider(values: [
        "http.host": "127.0.0.1",
        "http.port": "0",
        "log.level": "trace",
    ])
])

@Suite
struct AppTests {
    @Test
    func hello() async throws {
        let app = try await buildApplication(reader: reader)
        try await app.test(.router) { client in
            try await client.execute(uri: "/", method: .get) { response in
                #expect(response.body == ByteBuffer(string: "Hello!"))
            }
        }
    }

    @Test
    func ws() async throws {
        let app = try await buildApplication(reader: reader)
        try await app.test(.live) { client in
            let closeFrame = try await client.ws("/ws") { inbound, outbound, context in
                // write "Hello"
                try await outbound.write(.text("Hello"))
                // read response and verify its contents
                var inboundIterator = inbound.messages(maxSize: .max).makeAsyncIterator()
                let message = try await inboundIterator.next()
                #expect(message == .text("Text message, length: 5"))
            }
            #expect(closeFrame?.closeCode == .normalClosure)
        }
    }
}
