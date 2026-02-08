// RAGSource.swift
// Source attribution for RAG responses

import Foundation

public struct RAGSource: Sendable {
    /// Document ID the chunk came from
    public let documentId: String

    /// Document title
    public let title: String

    /// The chunk text that was used as context
    public let snippet: String

    /// Similarity score (0.0–1.0)
    public let score: Double

    /// Optional labels from the source document
    public let labels: [String]

    public init(
        documentId: String,
        title: String,
        snippet: String,
        score: Double,
        labels: [String] = []
    ) {
        self.documentId = documentId
        self.title = title
        self.snippet = snippet
        self.score = score
        self.labels = labels
    }
}
