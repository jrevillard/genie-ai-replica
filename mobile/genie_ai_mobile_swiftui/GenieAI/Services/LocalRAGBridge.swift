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
        let provider = Self.resolveProvider()
        let config = RAGConfiguration(
            topK: Self.topK,
            chunkSize: Self.chunkSize,
            chunkOverlap: Self.chunkOverlap,
            similarityThreshold: Self.similarityThreshold,
            provider: provider,
            systemPromptTemplate: Self.systemPromptTemplate,
            temperature: Self.temperature
        )
        self.ragService = LocalRAGService(config: config)
    }

    /// Initialize with a specific model path for llama.cpp (overrides
    /// auto-detection).
    init(modelPath: String) {
        let config = RAGConfiguration(
            topK: Self.topK,
            chunkSize: Self.chunkSize,
            chunkOverlap: Self.chunkOverlap,
            similarityThreshold: Self.similarityThreshold,
            provider: .llamaCpp(modelPath: modelPath),
            systemPromptTemplate: Self.systemPromptTemplate,
            temperature: Self.temperature
        )
        self.ragService = LocalRAGService(config: config)
    }

    /// Search the standard locations for a GGUF model and pick llama.cpp if
    /// one is present, otherwise fall back to Apple's FoundationModels (iOS
    /// 26+; otherwise LocalRAG's no-op provider). Order:
    ///   1. <Documents>/Models/*.gguf — preferred path so the user can drop
    ///      a model via the Files app or `xcrun simctl push` without
    ///      rebuilding the app.
    ///   2. App bundle resource (any `.gguf` inside the .app) — handy for
    ///      development with a bundled fixture.
    /// The first .gguf found wins. Recommended model:
    ///   gemma-2-2b-it-Q4_K_M.gguf (≈1.6GB) — instruction-tuned, fits in
    ///   phone RAM, uses the `<start_of_turn>` chat template baked into
    ///   LlamaCppProvider.
    private static func resolveProvider() -> LLMProviderType {
        let fm = FileManager.default

        // 1. Documents/Models/
        if let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first {
            let modelsDir = docs.appendingPathComponent("Models", isDirectory: true)
            if let candidates = try? fm.contentsOfDirectory(at: modelsDir, includingPropertiesForKeys: nil),
               let gguf = candidates.first(where: { $0.pathExtension.lowercased() == "gguf" }) {
                logger.info("LocalRAG: using llama.cpp model at \(gguf.path)")
                return .llamaCpp(modelPath: gguf.path)
            }
        }

        // 2. App bundle resource
        if let bundled = Bundle.main.urls(forResourcesWithExtension: "gguf", subdirectory: nil)?.first {
            logger.info("LocalRAG: using bundled llama.cpp model at \(bundled.path)")
            return .llamaCpp(modelPath: bundled.path)
        }

        logger.info("LocalRAG: no .gguf found in Documents/Models or app bundle — falling back to FoundationModels")
        return .foundationModels
    }

    // Retrieval tuning for the on-device pipeline. Apple's NLEmbedding
    // produces lower-magnitude cosine similarities than dense LLM-style
    // embeddings, so LocalRAG's default `similarityThreshold` of 0.3 routinely
    // dropped every chunk and surfaced as "No relevant context found.". Keep
    // the threshold permissive and let top-K + downstream reranking (when
    // present) do the filtering instead. topK = 8 gives the LLM enough
    // context to cite without blowing the context window for short queries.
    private static let topK = 8
    private static let similarityThreshold = 0.05

    // Chunking tuning. LocalRAG defaults are 500 chars / 50 overlap — fine
    // for sentence-precision retrieval but too narrow for an LLM doing
    // RAG: relevant facts get split across multiple chunks, and a 500-char
    // hit rarely contains enough context to support a useful citation. Use
    // 1200 chars / 200 overlap so each retrieved chunk holds roughly a
    // paragraph or two. NLEmbedding still works at this length (it embeds
    // the whole chunk as one vector) and the cosine signal is strong
    // enough for top-K retrieval.
    private static let chunkSize = 1200
    private static let chunkOverlap = 200

    // Generation tuning. LocalRAG's default temperature is 0.7 (calibrated
    // for free-form chat); for RAG we want grounded answers that quote and
    // cite verbatim, so drop temp to 0.2. This noticeably reduced
    // hallucinated phone numbers / URLs in early testing with Apple's
    // FoundationModels backend, which is otherwise loose about following
    // citation instructions.
    private static let temperature: Float = 0.2

    /// Mirrors the server-side chatqna prompt: ground answers in the
    /// retrieved chunks, cite each fact inline with [Source: <title>], and
    /// abstain when the context is empty instead of falling back to the
    /// model's general knowledge. The {context} placeholder is filled by
    /// LocalRAG's ContextFormatter with chunks formatted as
    /// `[N] From "<file_name>" (relevance: X%):` so the model has a concrete
    /// title to put inside each citation.
    private static let systemPromptTemplate = """
    You are a friendly and polite information assistant.

    Your task is to answer the user's latest question using ONLY the content provided from the knowledge base below. The knowledge base is the ONLY source of truth — your own prior knowledge is irrelevant for this task.

    **Strict rules:**
    - Do NOT invent, assume, or extrapolate information. Every concrete fact in your answer (names, codes, URLs, phone numbers, dates, deadlines, prices, statistics, helpline numbers, organisation names) MUST appear verbatim in one of the retrieved chunks below. If you cannot point to a specific chunk for a fact, do not state that fact.
    - If the knowledge base content does NOT contain a direct answer to the question, do not invent partial answers, "general guidance", "things to consider", or numbered lists from your training. Reply with one short sentence saying the offline library does not cover this question, and stop.
    - Cite every fact-bearing statement inline with [Source: <title>] immediately after the statement. The title is shown in the context as `From "<title>"`; copy that title verbatim — never paraphrase, abbreviate, or invent a title.
    - End your reply with a single line `Sources: <comma-separated list of titles you cited>`. If you cited nothing, write `Sources:` followed by an empty list.

    **Example (illustrative — do not reuse content):**
    ```
    Eligible adults can register at the Service Centre on weekdays [Source: example-policy.pdf]. Registration requires a birth certificate [Source: example-policy.pdf].
    Sources: example-policy.pdf
    ```

    **Style rules:**
    - Reply directly as a chat message. Do NOT use letter-style framing: no "Dear …" / "Hello <Name>," opener; no "Best regards", "Sincerely", "[Your Assistant]" or any signoff.
    - Keep answers informative but concise; expand only when explicitly requested.

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
