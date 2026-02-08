// DocumentIndexer.swift
// Chunks, embeds, and stores documents in the vector store

import Foundation
import os

public actor DocumentIndexer {
    private let chunker: TextChunker
    private let embeddingService: EmbeddingService
    private let vectorStore: VectorStore
    private static let logger = Logger(subsystem: "com.genieai", category: "rag.pipeline")

    public init(
        chunker: TextChunker,
        embeddingService: EmbeddingService,
        vectorStore: VectorStore
    ) {
        self.chunker = chunker
        self.embeddingService = embeddingService
        self.vectorStore = vectorStore
    }

    /// Index a single document: chunk → embed → store
    public func index(_ document: RAGDocument) async throws {
        Self.logger.info("Indexing document: id=\(document.id), title=\(document.title), contentLength=\(document.content.count)")

        let clock = ContinuousClock()
        let startTime = clock.now

        let textChunks = chunker.chunk(document.content)

        guard !textChunks.isEmpty else {
            throw LocalRAGError.indexingFailed("Document produced no chunks: \(document.title)")
        }

        let labels = Array(document.metadata.values)

        var documentChunks: [DocumentChunk] = []

        for (index, chunkText) in textChunks.enumerated() {
            let embedding = try await embeddingService.embed(chunkText)

            let chunk = DocumentChunk(
                documentId: document.id,
                documentTitle: document.title,
                content: chunkText,
                chunkIndex: index,
                embedding: embedding,
                labels: labels
            )
            documentChunks.append(chunk)
        }

        await vectorStore.addChunks(documentChunks)

        let duration = clock.now - startTime
        let durationMs = Int(duration.components.seconds * 1000 + duration.components.attoseconds / 1_000_000_000_000_000)
        Self.logger.info("Document indexed: id=\(document.id), title=\(document.title), chunks=\(documentChunks.count), duration=\(durationMs)ms")
    }

    /// Index multiple documents
    public func indexAll(_ documents: [RAGDocument]) async throws {
        Self.logger.info("Batch indexing: documents=\(documents.count)")
        for document in documents {
            try await index(document)
        }
    }

    /// Remove a document from the index
    public func removeDocument(_ documentId: String) async {
        await vectorStore.removeDocument(documentId)
    }

    /// Clear all indexed documents
    public func clearIndex() async {
        await vectorStore.clear()
    }

    /// Number of indexed chunks
    public var chunkCount: Int {
        get async {
            await vectorStore.count
        }
    }
}
