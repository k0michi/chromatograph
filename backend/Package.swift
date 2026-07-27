// swift-tools-version:6.3
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "chromatograph-backend",
    platforms: [.macOS(.v15), .iOS(.v18), .tvOS(.v18)],
    products: [
        .executable(name: "chromatograph-backend", targets: ["chromatograph-backend"]),
    ],
    dependencies: [
        .package(url: "https://github.com/hummingbird-project/hummingbird.git", from: "2.25.0"),
        .package(url: "https://github.com/hummingbird-project/hummingbird-websocket.git", from: "2.7.0"),
        .package(url: "https://github.com/apple/swift-configuration.git", from: "1.0.0", traits: [.defaults, "CommandLineArguments"]),
    ],
    targets: [
        .executableTarget(name: "chromatograph-backend",
            dependencies: [
                .product(name: "Configuration", package: "swift-configuration"),
                .product(name: "Hummingbird", package: "hummingbird"),
                .product(name: "HummingbirdWebSocket", package: "hummingbird-websocket"),
            ],
            path: "Sources/App"
        ),
        .testTarget(name: "chromatograph-backendTests",
            dependencies: [
                .byName(name: "chromatograph-backend"),
                .product(name: "HummingbirdTesting", package: "hummingbird"),
                .product(name: "HummingbirdWSTesting", package: "hummingbird-websocket"),
            ],
            path: "Tests/AppTests"
        )
    ]
)
