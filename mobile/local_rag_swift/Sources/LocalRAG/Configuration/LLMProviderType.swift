// LLMProviderType.swift
// Enum for selecting the LLM backend

import Foundation

public enum LLMProviderType: Sendable {
    /// Use llama.cpp with a GGUF model file (Gemma, Llama, Mistral, etc.)
    case llamaCpp(modelPath: String)

    /// Use Apple FoundationModels (iOS 26+ / macOS 26+)
    case foundationModels
}
