// RAGResponse.swift
// Output from the RAG pipeline

import Foundation

public struct RAGResponse: Sendable {
    /// Generated text content
    public let content: String

    /// Source documents that contributed to the response
    public let sources: [RAGSource]

    /// Overall confidence score (0.0–1.0)
    public let confidence: Double

    public init(content: String, sources: [RAGSource], confidence: Double) {
        self.content = content
        self.sources = sources
        self.confidence = confidence
    }
}
