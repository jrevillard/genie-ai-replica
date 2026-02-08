// LocalRAGService.swift
// Main facade for the LocalRAG pipeline

import Foundation
import os

public actor LocalRAGService {
    private let config: RAGConfiguration
    private let provider: any LLMProvider
    private let embeddingService: EmbeddingService
    private let vectorStore: VectorStore
    private let indexer: DocumentIndexer
    private let formatter: ContextFormatter
    private static let logger = Logger(subsystem: "com.genieai", category: "rag.pipeline")

    public init(config: RAGConfiguration = RAGConfiguration()) {
        self.config = config
        self.embeddingService = EmbeddingService(language: config.embeddingLanguage)
        self.vectorStore = VectorStore()

        let chunker = TextChunker(chunkSize: config.chunkSize, overlap: config.chunkOverlap)
        self.indexer = DocumentIndexer(
            chunker: chunker,
            embeddingService: embeddingService,
            vectorStore: vectorStore
        )
        self.formatter = ContextFormatter()

        // Create the appropriate provider
        self.provider = Self.createProvider(for: config.provider)
    }

    // MARK: - Provider Factory

    private static func createProvider(for type: LLMProviderType) -> any LLMProvider {
        switch type {
        case .llamaCpp(let modelPath):
            return LlamaCppProvider(modelPath: modelPath)
        case .foundationModels:
            #if canImport(FoundationModels)
            if #available(iOS 26, macOS 26, *) {
                return FoundationModelsProvider()
            }
            #endif
            return FoundationModelsFallbackProvider()
        }
    }

    // MARK: - Model Lifecycle

    /// Load the LLM model and embedding service
    public func loadModel() async throws {
        let providerType = String(describing: config.provider)
        Self.logger.info("Loading model: provider=\(providerType)")

        let clock = ContinuousClock()
        let startTime = clock.now

        try await embeddingService.load()
        try await provider.loadModel()

        let duration = clock.now - startTime
        let durationMs = Int(duration.components.seconds * 1000 + duration.components.attoseconds / 1_000_000_000_000_000)
        Self.logger.info("Model loaded: provider=\(providerType), duration=\(durationMs)ms")
    }

    /// Unload the LLM model
    public func unloadModel() async {
        Self.logger.info("Unloading model")
        await provider.unloadModel()
    }

    /// Whether the LLM model is loaded and ready
    public var isReady: Bool {
        get async {
            await provider.isReady
        }
    }

    // MARK: - Document Management

    /// Index a document for RAG retrieval
    public func indexDocument(_ document: RAGDocument) async throws {
        try await indexer.index(document)
    }

    /// Index multiple documents
    public func indexDocuments(_ documents: [RAGDocument]) async throws {
        try await indexer.indexAll(documents)
    }

    /// Remove a document from the index
    public func removeDocument(_ documentId: String) async {
        await indexer.removeDocument(documentId)
    }

    /// Clear all indexed documents
    public func clearIndex() async {
        await indexer.clearIndex()
    }

    /// Number of indexed chunks
    public var indexedChunkCount: Int {
        get async {
            await indexer.chunkCount
        }
    }

    // MARK: - Query

    /// Submit a RAG query and get a response
    public func query(_ ragQuery: RAGQuery) async throws -> RAGResponse {
        guard await provider.isReady else {
            Self.logger.error("Query failed: model not loaded")
            throw LocalRAGError.modelNotLoaded
        }

        Self.logger.info("Pipeline query: textLength=\(ragQuery.text.count), history=\(ragQuery.conversationHistory.count), labels=\(ragQuery.categoryLabels.joined(separator: ","))")
        Self.logger.debug("Pipeline query text: \(ragQuery.text)")
        for (i, msg) in ragQuery.conversationHistory.enumerated() {
            Self.logger.debug("Pipeline history[\(i)] role=\(msg.role.rawValue): \(msg.content)")
        }

        let clock = ContinuousClock()
        let pipelineStart = clock.now

        // Step 1: Embed the query
        let embedStart = clock.now
        let queryEmbedding = try await embeddingService.embed(ragQuery.text)
        let embedDuration = clock.now - embedStart

        // Step 2: Search for relevant chunks
        let searchStart = clock.now
        let results = await vectorStore.search(
            queryEmbedding: queryEmbedding,
            topK: config.topK,
            threshold: config.similarityThreshold,
            labels: ragQuery.categoryLabels.isEmpty ? nil : ragQuery.categoryLabels
        )
        let searchDuration = clock.now - searchStart
        let searchMs = Int(searchDuration.components.seconds * 1000 + searchDuration.components.attoseconds / 1_000_000_000_000_000)
        let topScore = results.first?.score ?? 0.0
        Self.logger.info("Vector search: chunks=\(results.count), topScore=\(topScore, format: .fixed(precision: 3)), threshold=\(self.config.similarityThreshold, format: .fixed(precision: 2)), topK=\(self.config.topK), duration=\(searchMs)ms")

        // Step 3: Format context
        let context = formatter.format(chunks: results)
        let systemPrompt = formatter.applyTemplate(config.systemPromptTemplate, context: context)
        Self.logger.debug("Prompt: templateLength=\(self.config.systemPromptTemplate.count), resolvedLength=\(systemPrompt.count), contextLength=\(context.count)")
        Self.logger.debug("Resolved system prompt: \(systemPrompt)")

        // Step 4: Generate response
        let generationConfig = LLMGenerationConfig(
            maxTokens: config.maxGenerationTokens,
            temperature: config.temperature
        )
        Self.logger.info("Generation start: maxTokens=\(generationConfig.maxTokens), temperature=\(generationConfig.temperature, format: .fixed(precision: 2)), topK=\(generationConfig.topK), topP=\(generationConfig.topP, format: .fixed(precision: 2))")

        let generateStart = clock.now
        let responseText = try await provider.generate(
            systemPrompt: systemPrompt,
            messages: ragQuery.conversationHistory,
            context: context,
            config: generationConfig
        )
        let generateDuration = clock.now - generateStart
        let generateMs = Int(generateDuration.components.seconds * 1000 + generateDuration.components.attoseconds / 1_000_000_000_000_000)
        Self.logger.info("Generation done: responseLength=\(responseText.count), duration=\(generateMs)ms")
        Self.logger.debug("Pipeline response text: \(responseText)")

        // Step 5: Build sources
        let sources = results.map { result in
            RAGSource(
                documentId: result.chunk.documentId,
                title: result.chunk.documentTitle,
                snippet: String(result.chunk.content.prefix(200)),
                score: result.score,
                labels: result.chunk.labels
            )
        }

        // Compute confidence from average similarity
        let avgScore = results.isEmpty ? 0.0 : results.map(\.score).reduce(0, +) / Double(results.count)

        let totalDuration = clock.now - pipelineStart
        let totalMs = Int(totalDuration.components.seconds * 1000 + totalDuration.components.attoseconds / 1_000_000_000_000_000)
        let embedMs = Int(embedDuration.components.seconds * 1000 + embedDuration.components.attoseconds / 1_000_000_000_000_000)
        Self.logger.info("Pipeline complete: totalDuration=\(totalMs)ms (embed=\(embedMs)ms, search=\(searchMs)ms, generate=\(generateMs)ms), confidence=\(avgScore, format: .fixed(precision: 3)), sources=\(sources.count)")

        return RAGResponse(
            content: responseText,
            sources: sources,
            confidence: avgScore
        )
    }
}
