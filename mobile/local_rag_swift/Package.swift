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
        // The previous dependency was StanfordBDHG/llama.cpp v0.3.3, which
        // was archived on 2024-05-12 — before upstream llama.cpp added
        // Gemma 2 support and rewrote the sampling API in mid-2024. Use
        // mattt/llama.swift instead, which is a thin SPM wrapper around
        // the official ggml-org/llama.cpp prebuilt XCFramework. Its
        // versioning maps to upstream build numbers (2.bXXXX.0), so
        // 2.9128.0 == llama.cpp build b9128, well after Gemma 2 landed.
        .package(url: "https://github.com/mattt/llama.swift", from: "2.9128.0")
    ],
    targets: [
        .target(
            name: "LocalRAG",
            dependencies: [
                .product(name: "LlamaSwift", package: "llama.swift")
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
