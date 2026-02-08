// RAGQuery.swift
// Query input for the RAG pipeline

import Foundation

public struct RAGQuery: Sendable {
    /// The user's question
    public let text: String

    /// Optional conversation history for context
    public let conversationHistory: [LLMMessage]

    /// Optional category labels to filter relevant chunks
    public let categoryLabels: [String]

    public init(
        text: String,
        conversationHistory: [LLMMessage] = [],
        categoryLabels: [String] = []
    ) {
        self.text = text
        self.conversationHistory = conversationHistory
        self.categoryLabels = categoryLabels
    }
}
