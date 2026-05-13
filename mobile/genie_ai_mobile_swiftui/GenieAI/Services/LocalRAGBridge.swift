// LocalRAGBridge.swift
// Bridge between LocalRAG package and the GenieAI app

import Foundation
import LocalRAG
import os

@Observable
class LocalRAGBridge {
    private let ragService: LocalRAGService
    private static let logger = Logger(subsystem: "com.genieai", category: "llm.local")
    private(set) var isReady = false
    private(set) var isLoading = false
    private(set) var error: String?

    init() {
        let config = RAGConfiguration(
            provider: .foundationModels,
            systemPromptTemplate: Self.systemPromptTemplate
        )
        self.ragService = LocalRAGService(config: config)
    }

    /// Initialize with a specific model path for llama.cpp
    init(modelPath: String) {
        let config = RAGConfiguration(
            provider: .llamaCpp(modelPath: modelPath),
            systemPromptTemplate: Self.systemPromptTemplate
        )
        self.ragService = LocalRAGService(config: config)
    }

    /// Mirrors the server-side chatqna prompt: ground answers in the
    /// retrieved chunks, cite each fact inline with [Source: <title>], and
    /// abstain when the context is empty instead of falling back to the
    /// model's general knowledge. The {context} placeholder is filled by
    /// LocalRAG's ContextFormatter with chunks formatted as
    /// `[N] From "<file_name>" (relevance: X%):` so the model has a concrete
    /// title to put inside each citation.
    private static let systemPromptTemplate = """
    You are a friendly and polite information assistant.

    Your task is to answer the user's latest question using only the content provided from the knowledge base below.

    **Strict rules:**
    - Do NOT invent, assume, or extrapolate information. Every concrete fact in your answer (names, codes, URLs, phone numbers, dates, deadlines, prices, statistics, organisation names) MUST appear verbatim in the provided knowledge-base content.
    - If the knowledge base content does NOT directly answer the question, do not attempt a partial answer or "general guidance". Say clearly that the requested information is not available in the offline library and stop.
    - When you use a fact from a retrieved document, cite it inline using the exact format [Source: <document title>] immediately after the statement. The document title is shown in the context as `From "<title>"`. Use that title verbatim; never invent a title.

    **Style rules:**
    - Reply directly as a chat message. Do NOT use letter-style framing: no "Dear …", "Hello <Name>", opener; no "Best regards", "Sincerely", "[Your Assistant]", or any signoff at the end.
    - Keep answers informative but concise; expand only when necessary or explicitly requested.

    Knowledge base content:
    {context}
    """

    /// Load the LLM model and embedding service
    func initialize() async {
        isLoading = true
        error = nil

        Self.logger.info("Initializing local RAG model...")

        let clock = ContinuousClock()
        let startTime = clock.now

        do {
            try await ragService.loadModel()
            let duration = clock.now - startTime
            let durationMs = Int(duration.components.seconds * 1000 + duration.components.attoseconds / 1_000_000_000_000_000)
            Self.logger.info("Local RAG model loaded successfully, duration=\(durationMs)ms")
            await MainActor.run {
                self.isReady = true
                self.isLoading = false
            }
        } catch {
            let duration = clock.now - startTime
            let durationMs = Int(duration.components.seconds * 1000 + duration.components.attoseconds / 1_000_000_000_000_000)
            await MainActor.run {
                self.error = error.localizedDescription
                self.isLoading = false
            }
            Self.logger.error("Initialization failed after \(durationMs)ms: \(error.localizedDescription)")
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

        Self.logger.info("Local query: length=\(query.count), history=\(conversationHistory.count), labels=\(contextLabels.joined(separator: ","))")
        Self.logger.debug("Local query text: \(query)")
        for (i, msg) in conversationHistory.enumerated() {
            Self.logger.debug("Local query history[\(i)] role=\(msg.role.rawValue): \(msg.actualContent ?? msg.content)")
        }

        let clock = ContinuousClock()
        let startTime = clock.now

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

        let duration = clock.now - startTime
        let durationMs = Int(duration.components.seconds * 1000 + duration.components.attoseconds / 1_000_000_000_000_000)
        Self.logger.info("Local response: contentLength=\(ragResponse.content.count), confidence=\(ragResponse.confidence, format: .fixed(precision: 2)), sources=\(ragResponse.sources.count), duration=\(durationMs)ms")
        Self.logger.debug("Local response text: \(ragResponse.content)")
        Self.logger.debug("Local response sources: \(ragResponse.sources.map { "\($0.title)(\($0.score))" }.joined(separator: ", "))")

        // Map RAGResponse to QueryResponse via JSON roundtrip
        return ragResponseToQueryResponse(ragResponse)
    }

    /// Index a document for RAG retrieval
    func indexDocument(title: String, content: String, metadata: [String: String] = [:]) async throws {
        Self.logger.info("Indexing document: title=\(title), contentLength=\(content.count)")
        let document = RAGDocument(title: title, content: content, metadata: metadata)
        try await ragService.indexDocument(document)
    }

    /// Index a document with an explicit ID (so we can remove it later by the
    /// same ID). Used by the offline-library indexer to keep the local vector
    /// store in sync with the on-disk cache.
    func indexDocument(id: String, title: String, content: String, metadata: [String: String] = [:]) async throws {
        Self.logger.info("Indexing document id=\(id) title=\(title) contentLength=\(content.count)")
        let document = RAGDocument(id: id, title: title, content: content, metadata: metadata)
        try await ragService.indexDocument(document)
    }

    /// Remove a previously-indexed document from the local vector store.
    func removeDocument(id: String) async {
        Self.logger.info("Removing document id=\(id)")
        await ragService.removeDocument(id)
    }

    /// Wipe the local vector store. Useful when re-indexing from scratch.
    func clearIndex() async {
        Self.logger.info("Clearing local index")
        await ragService.clearIndex()
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
            Self.logger.error("JSON roundtrip failed: \(error.localizedDescription)")
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
