// TextChunkerTests.swift

import XCTest
@testable import LocalRAG

final class TextChunkerTests: XCTestCase {
    func testEmptyText() {
        let chunker = TextChunker(chunkSize: 100, overlap: 20)
        let chunks = chunker.chunk("")
        XCTAssertTrue(chunks.isEmpty)
    }

    func testShortText() {
        let chunker = TextChunker(chunkSize: 500, overlap: 50)
        let text = "This is a short sentence."
        let chunks = chunker.chunk(text)
        XCTAssertEqual(chunks.count, 1)
        XCTAssertEqual(chunks.first, text)
    }

    func testLongTextProducesMultipleChunks() {
        let chunker = TextChunker(chunkSize: 100, overlap: 20)

        // Build text with several sentences
        let sentences = (1...20).map { "This is sentence number \($0) in the document." }
        let text = sentences.joined(separator: " ")

        let chunks = chunker.chunk(text)
        XCTAssertTrue(chunks.count > 1, "Expected multiple chunks, got \(chunks.count)")

        // Verify all original content is covered
        for sentence in sentences {
            let found = chunks.contains { $0.contains("sentence number \(sentence.components(separatedBy: " ")[4])") }
            XCTAssertTrue(found, "Sentence should be in at least one chunk")
        }
    }

    func testChunkSizeRespected() {
        let chunkSize = 150
        let chunker = TextChunker(chunkSize: chunkSize, overlap: 30)

        let sentences = (1...10).map { "Sentence \($0) has some content here." }
        let text = sentences.joined(separator: " ")

        let chunks = chunker.chunk(text)

        // First chunk should be at most slightly over chunkSize (due to sentence boundaries)
        // Allow 2x for sentence boundary flexibility
        for chunk in chunks {
            XCTAssertTrue(chunk.count < chunkSize * 2, "Chunk too large: \(chunk.count) chars")
        }
    }

    func testNoOverlap() {
        let chunker = TextChunker(chunkSize: 100, overlap: 0)
        let text = "First sentence here. Second sentence here. Third sentence here. Fourth sentence here. Fifth sentence here."
        let chunks = chunker.chunk(text)
        XCTAssertTrue(chunks.count >= 1)
    }
}
