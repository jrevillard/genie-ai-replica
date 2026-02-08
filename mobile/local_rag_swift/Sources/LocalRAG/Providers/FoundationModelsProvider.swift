// FoundationModelsProvider.swift
// Apple FoundationModels provider (iOS 26+ / macOS 26+)

import Foundation
import os

#if canImport(FoundationModels)
import FoundationModels

@available(iOS 26, macOS 26, *)
public actor FoundationModelsProvider: LLMProvider {
    private var session: LanguageModelSession?
    private static let logger = Logger(subsystem: "com.genieai", category: "llm.local.foundationmodels")

    public init() {}

    public var isReady: Bool {
        session != nil
    }

    public func loadModel() async throws {
        guard !isReady else { return }
        Self.logger.info("Loading FoundationModels session")
        let clock = ContinuousClock()
        let startTime = clock.now
        // FoundationModels loads on-demand; creating a session is sufficient
        session = LanguageModelSession()
        let duration = clock.now - startTime
        let durationMs = Int(duration.components.seconds * 1000 + duration.components.attoseconds / 1_000_000_000_000_000)
        Self.logger.info("FoundationModels session created, duration=\(durationMs)ms")
    }

    public func unloadModel() async {
        Self.logger.info("Unloading FoundationModels session")
        session = nil
    }

    public func generate(
        systemPrompt: String,
        messages: [LLMMessage],
        context contextText: String,
        config: LLMGenerationConfig
    ) async throws -> String {
        let resolvedPrompt = systemPrompt.replacingOccurrences(of: "{context}", with: contextText)

        Self.logger.info("FoundationModels generate: systemPromptLength=\(systemPrompt.count), resolvedLength=\(resolvedPrompt.count), messages=\(messages.count), contextLength=\(contextText.count)")
        Self.logger.debug("FoundationModels resolved prompt: \(resolvedPrompt)")

        let clock = ContinuousClock()
        let startTime = clock.now

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

        let duration = clock.now - startTime
        let durationMs = Int(duration.components.seconds * 1000 + duration.components.attoseconds / 1_000_000_000_000_000)
        Self.logger.info("FoundationModels response: contentLength=\(response.content.count), duration=\(durationMs)ms")

        return response.content
    }
}
#endif

/// Fallback for platforms that don't support FoundationModels
public actor FoundationModelsFallbackProvider: LLMProvider {
    private static let logger = Logger(subsystem: "com.genieai", category: "llm.local.foundationmodels")

    public init() {}

    public var isReady: Bool { false }

    public func loadModel() async throws {
        Self.logger.error("FoundationModels unavailable on this platform/OS version")
        throw LocalRAGError.modelLoadFailed("FoundationModels is not available on this platform/OS version.")
    }

    public func unloadModel() async {}

    public func generate(
        systemPrompt: String,
        messages: [LLMMessage],
        context: String,
        config: LLMGenerationConfig
    ) async throws -> String {
        Self.logger.error("FoundationModels generate called but unavailable on this platform/OS version")
        throw LocalRAGError.generationFailed("FoundationModels is not available on this platform/OS version.")
    }
}
