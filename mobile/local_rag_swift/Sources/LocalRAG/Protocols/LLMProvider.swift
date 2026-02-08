// LLMProvider.swift
// Protocol for swappable LLM backends

import Foundation

/// A message in a conversation
public struct LLMMessage: Sendable {
    public enum Role: String, Sendable {
        case system
        case user
        case assistant
    }

    public let role: Role
    public let content: String

    public init(role: Role, content: String) {
        self.role = role
        self.content = content
    }
}

/// Configuration for text generation
public struct LLMGenerationConfig: Sendable {
    public var maxTokens: Int
    public var temperature: Float
    public var topK: Int
    public var topP: Float

    public init(
        maxTokens: Int = 1024,
        temperature: Float = 0.7,
        topK: Int = 40,
        topP: Float = 0.9
    ) {
        self.maxTokens = maxTokens
        self.temperature = temperature
        self.topK = topK
        self.topP = topP
    }
}

/// Protocol for LLM backends (llama.cpp, FoundationModels, etc.)
public protocol LLMProvider: Sendable {
    /// Whether the model is loaded and ready for generation
    var isReady: Bool { get async }

    /// Load the model into memory
    func loadModel() async throws

    /// Unload the model from memory
    func unloadModel() async

    /// Generate a response given a system prompt, messages, and retrieved context
    func generate(
        systemPrompt: String,
        messages: [LLMMessage],
        context: String,
        config: LLMGenerationConfig
    ) async throws -> String
}
