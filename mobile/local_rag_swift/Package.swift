// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "LocalRAG",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(name: "LocalRAG", targets: ["LocalRAG"])
    ],
    dependencies: [
        .package(url: "https://github.com/StanfordBDHG/llama.cpp", .upToNextMinor(from: "0.3.3"))
    ],
    targets: [
        .target(
            name: "LocalRAG",
            dependencies: [
                .product(name: "llama", package: "llama.cpp")
            ],
            swiftSettings: [
                .interoperabilityMode(.Cxx)
            ]
        ),
        .testTarget(
            name: "LocalRAGTests",
            dependencies: ["LocalRAG"],
            swiftSettings: [
                .interoperabilityMode(.Cxx)
            ]
        )
    ]
)
