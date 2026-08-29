// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CBOR",
    platforms: [.macOS(.v11), .iOS(.v14), .tvOS(.v14), .watchOS(.v7)],
    products: [.library(name: "CBOR", targets: ["CBOR"])],
    targets: [
        .target(name: "CBOR"),
        .testTarget(name: "CBORTests", dependencies: ["CBOR"]),
    ]
)
