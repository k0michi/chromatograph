// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "SwiftLibPNG",
  products: [.library(name: "LibPNG", targets: ["LibPNG"])],
  targets: [
    .systemLibrary(
      name: "CLibPNG",
      pkgConfig: "libpng",
      providers: [.apt(["libpng-dev"]), .brew(["libpng"])]
    ),
    .target(name: "CLibPNGBridge", dependencies: ["CLibPNG"]),
    .target(name: "LibPNG", dependencies: ["CLibPNGBridge"]),
    .testTarget(name: "LibPNGTests", dependencies: ["LibPNG"]),
  ]
)
