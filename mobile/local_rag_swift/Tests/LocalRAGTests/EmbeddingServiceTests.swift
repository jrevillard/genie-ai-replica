// EmbeddingServiceTests.swift

import XCTest
import NaturalLanguage
@testable import LocalRAG

final class EmbeddingServiceTests: XCTestCase {
    func testLoadEmbedding() async throws {
        let service = EmbeddingService(language: .english)
        try await service.load()
        let isLoaded = await service.isLoaded
        XCTAssertTrue(isLoaded)
    }

    func testEmbedText() async throws {
        let service = EmbeddingService(language: .english)
        try await service.load()

        let vector = try await service.embed("Hello, world!")
        XCTAssertFalse(vector.isEmpty)

        let dimension = await service.dimension
        XCTAssertEqual(vector.count, dimension)
    }

    func testSimilarTextsHaveHigherSimilarity() async throws {
        let service = EmbeddingService(language: .english)
        try await service.load()

        let v1 = try await service.embed("The weather is sunny today")
        let v2 = try await service.embed("It is a bright and sunny day")
        let v3 = try await service.embed("Quantum computing uses qubits")

        let sim12 = cosineSim(v1, v2)
        let sim13 = cosineSim(v1, v3)

        // Similar texts should have higher cosine similarity
        XCTAssertGreaterThan(sim12, sim13, "Similar texts should have higher similarity")
    }

    func testEmbedWithoutLoadThrows() async {
        let service = EmbeddingService(language: .english)
        do {
            _ = try await service.embed("test")
            XCTFail("Should throw when not loaded")
        } catch {
            // Expected
        }
    }

    // MARK: - Helper

    private func cosineSim(_ a: [Double], _ b: [Double]) -> Double {
        guard a.count == b.count else { return 0 }
        var dot = 0.0, na = 0.0, nb = 0.0
        for i in 0..<a.count {
            dot += a[i] * b[i]
            na += a[i] * a[i]
            nb += b[i] * b[i]
        }
        let denom = sqrt(na) * sqrt(nb)
        return denom > 0 ? dot / denom : 0
    }
}
