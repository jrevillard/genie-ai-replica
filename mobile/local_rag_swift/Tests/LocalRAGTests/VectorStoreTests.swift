// VectorStoreTests.swift

import XCTest
@testable import LocalRAG

final class VectorStoreTests: XCTestCase {
    func testAddAndSearch() async {
        let store = VectorStore()

        // Create chunks with simple embeddings
        let chunk1 = DocumentChunk(
            documentId: "doc1",
            documentTitle: "Test Doc",
            content: "Hello world",
            chunkIndex: 0,
            embedding: [1.0, 0.0, 0.0]
        )
        let chunk2 = DocumentChunk(
            documentId: "doc1",
            documentTitle: "Test Doc",
            content: "Goodbye world",
            chunkIndex: 1,
            embedding: [0.0, 1.0, 0.0]
        )

        await store.addChunks([chunk1, chunk2])

        let count = await store.count
        XCTAssertEqual(count, 2)

        // Search with query similar to chunk1
        let results = await store.search(
            queryEmbedding: [0.9, 0.1, 0.0],
            topK: 1,
            threshold: 0.0
        )
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results.first?.chunk.content, "Hello world")
    }

    func testCosineSimilarityOrdering() async {
        let store = VectorStore()

        let chunks = [
            DocumentChunk(documentId: "d1", documentTitle: "A", content: "A", chunkIndex: 0, embedding: [1.0, 0.0]),
            DocumentChunk(documentId: "d2", documentTitle: "B", content: "B", chunkIndex: 0, embedding: [0.5, 0.5]),
            DocumentChunk(documentId: "d3", documentTitle: "C", content: "C", chunkIndex: 0, embedding: [0.0, 1.0]),
        ]

        await store.addChunks(chunks)

        let results = await store.search(queryEmbedding: [1.0, 0.0], topK: 3, threshold: 0.0)
        XCTAssertEqual(results.count, 3)
        // First result should be most similar to [1.0, 0.0]
        XCTAssertEqual(results.first?.chunk.content, "A")
    }

    func testThresholdFiltering() async {
        let store = VectorStore()

        let chunks = [
            DocumentChunk(documentId: "d1", documentTitle: "A", content: "A", chunkIndex: 0, embedding: [1.0, 0.0]),
            DocumentChunk(documentId: "d2", documentTitle: "B", content: "B", chunkIndex: 0, embedding: [0.0, 1.0]),
        ]

        await store.addChunks(chunks)

        // High threshold should exclude dissimilar chunks
        let results = await store.search(queryEmbedding: [1.0, 0.0], topK: 10, threshold: 0.9)
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results.first?.chunk.content, "A")
    }

    func testLabelFiltering() async {
        let store = VectorStore()

        let chunks = [
            DocumentChunk(documentId: "d1", documentTitle: "A", content: "Health info", chunkIndex: 0, embedding: [1.0, 0.0], labels: ["health"]),
            DocumentChunk(documentId: "d2", documentTitle: "B", content: "Finance info", chunkIndex: 0, embedding: [0.9, 0.1], labels: ["finance"]),
        ]

        await store.addChunks(chunks)

        let results = await store.search(
            queryEmbedding: [1.0, 0.0],
            topK: 10,
            threshold: 0.0,
            labels: ["health"]
        )
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results.first?.chunk.content, "Health info")
    }

    func testRemoveDocument() async {
        let store = VectorStore()

        let chunks = [
            DocumentChunk(documentId: "d1", documentTitle: "A", content: "A", chunkIndex: 0, embedding: [1.0, 0.0]),
            DocumentChunk(documentId: "d2", documentTitle: "B", content: "B", chunkIndex: 0, embedding: [0.0, 1.0]),
        ]

        await store.addChunks(chunks)
        await store.removeDocument("d1")

        let count = await store.count
        XCTAssertEqual(count, 1)
    }

    func testClear() async {
        let store = VectorStore()

        let chunk = DocumentChunk(documentId: "d1", documentTitle: "A", content: "A", chunkIndex: 0, embedding: [1.0])
        await store.addChunks([chunk])
        await store.clear()

        let count = await store.count
        XCTAssertEqual(count, 0)
    }
}
