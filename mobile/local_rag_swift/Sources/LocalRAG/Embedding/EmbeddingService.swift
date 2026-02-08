// EmbeddingService.swift
// Wrapper around NLEmbedding for sentence embeddings

import Foundation
import NaturalLanguage

public actor EmbeddingService {
    private let language: NLLanguage
    private var embedding: NLEmbedding?

    public init(language: NLLanguage = .english) {
        self.language = language
    }

    /// Load the sentence embedding model
    public func load() throws {
        guard let emb = NLEmbedding.sentenceEmbedding(for: language) else {
            throw LocalRAGError.embeddingUnavailable
        }
        self.embedding = emb
    }

    /// Get the embedding vector for a text string
    public func embed(_ text: String) throws -> [Double] {
        guard let embedding else {
            throw LocalRAGError.embeddingUnavailable
        }

        guard let vector = embedding.vector(for: text) else {
            // Return zero vector if embedding fails for this text
            let dimension = embedding.dimension
            return [Double](repeating: 0.0, count: dimension)
        }

        return vector
    }

    /// Get the embedding dimension
    public var dimension: Int {
        embedding?.dimension ?? 512
    }

    /// Check if the embedding model is loaded
    public var isLoaded: Bool {
        embedding != nil
    }
}
