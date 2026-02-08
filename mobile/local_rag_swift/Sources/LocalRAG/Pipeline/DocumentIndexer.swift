// DocumentIndexer.swift
// Chunks, embeds, and stores documents in the vector store

import Foundation

public actor DocumentIndexer {
    private let chunker: TextChunker
    private let embeddingService: EmbeddingService
    private let vectorStore: VectorStore

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
    }

    /// Index multiple documents
    public func indexAll(_ documents: [RAGDocument]) async throws {
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
