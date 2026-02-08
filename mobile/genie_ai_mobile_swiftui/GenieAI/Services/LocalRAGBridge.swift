// LocalRAGBridge.swift
// Bridge between LocalRAG package and the GenieAI app

import Foundation
import LocalRAG

@Observable
class LocalRAGBridge {
    private let ragService: LocalRAGService
    private(set) var isReady = false
    private(set) var isLoading = false
    private(set) var error: String?

    init() {
        // Default to FoundationModels; can be reconfigured
        let config = RAGConfiguration(
            provider: .foundationModels,
            systemPromptTemplate: """
            You are a helpful government services assistant. Use the following context to answer \
            the user's question accurately. If the context doesn't contain relevant information, \
            answer based on your general knowledge.

            Context:
            {context}
            """
        )
        self.ragService = LocalRAGService(config: config)
    }

    /// Initialize with a specific model path for llama.cpp
    init(modelPath: String) {
        let config = RAGConfiguration(
            provider: .llamaCpp(modelPath: modelPath),
            systemPromptTemplate: """
            You are a helpful government services assistant. Use the following context to answer \
            the user's question accurately. If the context doesn't contain relevant information, \
            answer based on your general knowledge.

            Context:
            {context}
            """
        )
        self.ragService = LocalRAGService(config: config)
    }

    /// Load the LLM model and embedding service
    func initialize() async {
        isLoading = true
        error = nil

        do {
            try await ragService.loadModel()
            await MainActor.run {
                self.isReady = true
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
                self.isLoading = false
            }
            print("[LocalRAGBridge] Initialization failed: \(error)")
        }
    }

    /// Submit a query through the local RAG pipeline, returning a QueryResponse
    func submitQuery(
        query: String,
        conversationHistory: [Message],
        contextLabels: [String]
    ) async throws -> QueryResponse {
        guard isReady else {
            throw LocalRAGError.modelNotLoaded
        }

        // Convert app Messages to LLMMessages
        let llmMessages = conversationHistory.map { msg in
            LLMMessage(
                role: msg.role == .user ? .user : .assistant,
                content: msg.actualContent ?? msg.content
            )
        }

        let ragQuery = RAGQuery(
            text: query,
            conversationHistory: llmMessages,
            categoryLabels: contextLabels
        )

        let ragResponse = try await ragService.query(ragQuery)

        // Map RAGResponse to QueryResponse via JSON roundtrip
        return ragResponseToQueryResponse(ragResponse)
    }

    /// Index a document for RAG retrieval
    func indexDocument(title: String, content: String, metadata: [String: String] = [:]) async throws {
        let document = RAGDocument(title: title, content: content, metadata: metadata)
        try await ragService.indexDocument(document)
    }

    /// Number of indexed chunks
    var indexedChunkCount: Int {
        get async {
            await ragService.indexedChunkCount
        }
    }

    // MARK: - Private

    private func ragResponseToQueryResponse(_ ragResponse: RAGResponse) -> QueryResponse {
        // Build a JSON dictionary matching QueryResponse's Decodable expectations
        var json: [String: Any] = [
            "id": UUID().uuidString,
            "response": ragResponse.content,
            "confidence": ragResponse.confidence
        ]

        // Map RAGSources to DocumentSource-compatible dictionaries
        let sourceDicts: [[String: Any]] = ragResponse.sources.map { source in
            var dict: [String: Any] = [
                "document_id": source.documentId,
                "title": source.title,
                "snippet": source.snippet,
                "score": source.score
            ]
            if !source.labels.isEmpty {
                dict["labels"] = source.labels
            }
            return dict
        }
        if !sourceDicts.isEmpty {
            json["sources"] = sourceDicts
        }

        // Decode via JSON roundtrip
        do {
            let data = try JSONSerialization.data(withJSONObject: json)
            let decoder = JSONDecoder()
            return try decoder.decode(QueryResponse.self, from: data)
        } catch {
            // Fallback: return a minimal response
            print("[LocalRAGBridge] JSON roundtrip failed: \(error)")
            return Self.fallbackResponse(content: ragResponse.content)
        }
    }

    private static func fallbackResponse(content: String) -> QueryResponse {
        let json: [String: Any] = [
            "id": UUID().uuidString,
            "response": content
        ]
        let data = try! JSONSerialization.data(withJSONObject: json)
        return try! JSONDecoder().decode(QueryResponse.self, from: data)
    }
}
