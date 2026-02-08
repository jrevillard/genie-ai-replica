// RAGDocument.swift
// Input document for the RAG pipeline

import Foundation

public struct RAGDocument: Sendable, Identifiable {
    public let id: String
    public let title: String
    public let content: String
    public let metadata: [String: String]

    public init(
        id: String = UUID().uuidString,
        title: String,
        content: String,
        metadata: [String: String] = [:]
    ) {
        self.id = id
        self.title = title
        self.content = content
        self.metadata = metadata
    }
}
