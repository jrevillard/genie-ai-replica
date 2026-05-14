// swift-tools-version: 5.9
//
// LocalRAGCLI — a thin macOS executable that wraps the same LocalRAG
// pipeline running on iOS. Used by the LLM-as-a-judge test harness.
//
// The dependency on `LocalRAG` is a local path pointing at the sibling
// Swift package the mobile app uses (mobile/local_rag_swift/). Keeping
// it as a *local* dependency rather than a git/SPM reference means
// changes to LocalRAG land in this test harness immediately, and the
// harness always reflects the version on the current branch.

import PackageDescription

let package = Package(
    name: "LocalRAGCLI",
    platforms: [
        .macOS(.v14)
    ],
    dependencies: [
        // ../../mobile/local_rag_swift relative to this Package.swift.
        .package(path: "../../../mobile/local_rag_swift")
    ],
    targets: [
        .executableTarget(
            name: "LocalRAGCLI",
            dependencies: [
                .product(name: "LocalRAG", package: "local_rag_swift")
            ],
            swiftSettings: [
                // LocalRAG itself uses C++ interop because the underlying
                // llama.cpp XCFramework ships C++ headers. We have to match
                // that here, otherwise the executable won't link.
                .interoperabilityMode(.Cxx)
            ]
        )
    ]
)
