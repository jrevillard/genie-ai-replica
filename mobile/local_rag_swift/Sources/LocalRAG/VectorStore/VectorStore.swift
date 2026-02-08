// VectorStore.swift
// In-memory vector store with cosine similarity search

import Foundation
import os

public actor VectorStore {
    private var chunks: [DocumentChunk] = []
    private static let logger = Logger(subsystem: "com.genieai", category: "rag.vectorstore")

    public init() {}

    /// Add chunks to the store
    public func addChunks(_ newChunks: [DocumentChunk]) {
        chunks.append(contentsOf: newChunks)
        Self.logger.debug("Added chunks: count=\(newChunks.count), total=\(self.chunks.count)")
    }

    /// Remove all chunks for a given document ID
    public func removeDocument(_ documentId: String) {
        chunks.removeAll { $0.documentId == documentId }
    }

    /// Remove all chunks
    public func clear() {
        let count = chunks.count
        chunks.removeAll()
        Self.logger.info("Cleared vector store: removedChunks=\(count)")
    }

    /// Number of stored chunks
    public var count: Int {
        chunks.count
    }

    /// Search for the most similar chunks to a query embedding
    public func search(
        queryEmbedding: [Double],
        topK: Int = 5,
        threshold: Double = 0.3,
        labels: [String]? = nil
    ) -> [(chunk: DocumentChunk, score: Double)] {
        var candidates = chunks

        // Filter by labels if provided
        if let labels, !labels.isEmpty {
            let labelSet = Set(labels.map { $0.lowercased() })
            candidates = candidates.filter { chunk in
                !chunk.labels.isEmpty && !Set(chunk.labels.map { $0.lowercased() }).isDisjoint(with: labelSet)
            }
            // If label filtering returns nothing, fall back to all chunks
            if candidates.isEmpty {
                candidates = chunks
            }
        }

        // Compute cosine similarity for each candidate
        var scored: [(chunk: DocumentChunk, score: Double)] = candidates.compactMap { chunk in
            guard !chunk.embedding.isEmpty else { return nil }
            let score = cosineSimilarity(queryEmbedding, chunk.embedding)
            guard score >= threshold else { return nil }
            return (chunk: chunk, score: score)
        }

        // Sort by score descending and take top-K
        scored.sort { $0.score > $1.score }
        let results = Array(scored.prefix(topK))

        Self.logger.debug("Search: storeSize=\(self.chunks.count), topK=\(topK), threshold=\(threshold, format: .fixed(precision: 2)), labelFilter=\(labels?.joined(separator: ",") ?? "none"), candidates=\(candidates.count), results=\(results.count)")

        return results
    }

    // MARK: - Cosine Similarity

    private func cosineSimilarity(_ a: [Double], _ b: [Double]) -> Double {
        guard a.count == b.count, !a.isEmpty else { return 0.0 }

        var dotProduct = 0.0
        var normA = 0.0
        var normB = 0.0

        for i in 0..<a.count {
            dotProduct += a[i] * b[i]
            normA += a[i] * a[i]
            normB += b[i] * b[i]
        }

        let denominator = sqrt(normA) * sqrt(normB)
        guard denominator > 0 else { return 0.0 }

        return dotProduct / denominator
    }
}
