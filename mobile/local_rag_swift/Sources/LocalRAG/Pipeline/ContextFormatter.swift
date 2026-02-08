// ContextFormatter.swift
// Formats retrieved chunks into context for the LLM prompt

import Foundation

public struct ContextFormatter: Sendable {

    public init() {}

    /// Format retrieved chunks into a context string for the LLM
    public func format(chunks: [(chunk: DocumentChunk, score: Double)]) -> String {
        guard !chunks.isEmpty else {
            return "No relevant context found."
        }

        var parts: [String] = []

        for (index, result) in chunks.enumerated() {
            let header = "[\(index + 1)] From \"\(result.chunk.documentTitle)\" (relevance: \(String(format: "%.0f%%", result.score * 100))):"
            parts.append(header)
            parts.append(result.chunk.content)
            parts.append("")
        }

        return parts.joined(separator: "\n")
    }

    /// Apply context to a system prompt template
    public func applyTemplate(_ template: String, context: String) -> String {
        template.replacingOccurrences(of: "{context}", with: context)
    }
}
