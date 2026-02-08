// DocumentChunk.swift
// A chunk of a document with its embedding vector

import Foundation

public struct DocumentChunk: Sendable, Identifiable {
    public let id: String
    public let documentId: String
    public let documentTitle: String
    public let content: String
    public let chunkIndex: Int
    public var embedding: [Double]
    public let labels: [String]

    public init(
        id: String = UUID().uuidString,
        documentId: String,
        documentTitle: String,
        content: String,
        chunkIndex: Int,
        embedding: [Double] = [],
        labels: [String] = []
    ) {
        self.id = id
        self.documentId = documentId
        self.documentTitle = documentTitle
        self.content = content
        self.chunkIndex = chunkIndex
        self.embedding = embedding
        self.labels = labels
    }
}
