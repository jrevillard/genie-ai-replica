// FoundationModelsProvider.swift
// Apple FoundationModels provider (iOS 26+ / macOS 26+)

import Foundation

#if canImport(FoundationModels)
import FoundationModels

@available(iOS 26, macOS 26, *)
public actor FoundationModelsProvider: LLMProvider {
    private var session: LanguageModelSession?

    public init() {}

    public var isReady: Bool {
        session != nil
    }

    public func loadModel() async throws {
        guard !isReady else { return }
        // FoundationModels loads on-demand; creating a session is sufficient
        session = LanguageModelSession()
    }

    public func unloadModel() async {
        session = nil
    }

    public func generate(
        systemPrompt: String,
        messages: [LLMMessage],
        context contextText: String,
        config: LLMGenerationConfig
    ) async throws -> String {
        let resolvedPrompt = systemPrompt.replacingOccurrences(of: "{context}", with: contextText)

        // Create a new session with the system prompt as instructions
        let activeSession = LanguageModelSession(instructions: resolvedPrompt)
        self.session = activeSession

        // Build the user message from conversation history
        var userPrompt = ""
        for message in messages {
            switch message.role {
            case .user:
                userPrompt += "User: \(message.content)\n"
            case .assistant:
                userPrompt += "Assistant: \(message.content)\n"
            case .system:
                userPrompt += message.content + "\n"
            }
        }

        let response = try await activeSession.respond(to: userPrompt)
        return response.content
    }
}
#endif

/// Fallback for platforms that don't support FoundationModels
public actor FoundationModelsFallbackProvider: LLMProvider {
    public init() {}

    public var isReady: Bool { false }

    public func loadModel() async throws {
        throw LocalRAGError.modelLoadFailed("FoundationModels is not available on this platform/OS version.")
    }

    public func unloadModel() async {}

    public func generate(
        systemPrompt: String,
        messages: [LLMMessage],
        context: String,
        config: LLMGenerationConfig
    ) async throws -> String {
        throw LocalRAGError.generationFailed("FoundationModels is not available on this platform/OS version.")
    }
}
