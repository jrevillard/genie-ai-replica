// LocalRAGError.swift
// Error types for the LocalRAG pipeline

import Foundation

public enum LocalRAGError: LocalizedError {
    case modelNotLoaded
    case modelLoadFailed(String)
    case embeddingUnavailable
    case generationFailed(String)
    case indexingFailed(String)
    case noDocumentsIndexed
    case invalidConfiguration(String)

    public var errorDescription: String? {
        switch self {
        case .modelNotLoaded:
            return "LLM model is not loaded. Call loadModel() first."
        case .modelLoadFailed(let reason):
            return "Failed to load LLM model: \(reason)"
        case .embeddingUnavailable:
            return "Sentence embedding is not available for the configured language."
        case .generationFailed(let reason):
            return "Text generation failed: \(reason)"
        case .indexingFailed(let reason):
            return "Document indexing failed: \(reason)"
        case .noDocumentsIndexed:
            return "No documents have been indexed. Add documents before querying."
        case .invalidConfiguration(let reason):
            return "Invalid configuration: \(reason)"
        }
    }
}
