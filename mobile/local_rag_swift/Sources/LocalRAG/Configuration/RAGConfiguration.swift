// RAGConfiguration.swift
// Configuration for the RAG pipeline

import Foundation
import NaturalLanguage

public struct RAGConfiguration: Sendable {
    /// Number of top chunks to retrieve
    public var topK: Int

    /// Target chunk size in characters
    public var chunkSize: Int

    /// Overlap between chunks in characters
    public var chunkOverlap: Int

    /// Minimum similarity threshold for retrieved chunks
    public var similarityThreshold: Double

    /// LLM provider to use
    public var provider: LLMProviderType

    /// Language for NLEmbedding
    public var embeddingLanguage: NLLanguage

    /// System prompt template. Use {context} as placeholder for retrieved chunks.
    public var systemPromptTemplate: String

    /// Maximum tokens for LLM generation
    public var maxGenerationTokens: Int

    /// Temperature for LLM generation
    public var temperature: Float

    public init(
        topK: Int = 5,
        chunkSize: Int = 500,
        chunkOverlap: Int = 50,
        similarityThreshold: Double = 0.3,
        provider: LLMProviderType = .foundationModels,
        embeddingLanguage: NLLanguage = .english,
        systemPromptTemplate: String = Self.defaultSystemPrompt,
        maxGenerationTokens: Int = 1024,
        temperature: Float = 0.7
    ) {
        self.topK = topK
        self.chunkSize = chunkSize
        self.chunkOverlap = chunkOverlap
        self.similarityThreshold = similarityThreshold
        self.provider = provider
        self.embeddingLanguage = embeddingLanguage
        self.systemPromptTemplate = systemPromptTemplate
        self.maxGenerationTokens = maxGenerationTokens
        self.temperature = temperature
    }

    public static let defaultSystemPrompt = """
    You are a helpful assistant. Use the following context to answer the user's question. \
    If the context doesn't contain relevant information, say so and answer based on your general knowledge.

    Context:
    {context}
    """
}
