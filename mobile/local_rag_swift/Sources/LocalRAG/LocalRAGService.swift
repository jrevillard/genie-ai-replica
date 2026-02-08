// LocalRAGService.swift
// Main facade for the LocalRAG pipeline

import Foundation

public actor LocalRAGService {
    private let config: RAGConfiguration
    private let provider: any LLMProvider
    private let embeddingService: EmbeddingService
    private let vectorStore: VectorStore
    private let indexer: DocumentIndexer
    private let formatter: ContextFormatter

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
        try await embeddingService.load()
        try await provider.loadModel()
    }

    /// Unload the LLM model
    public func unloadModel() async {
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
            throw LocalRAGError.modelNotLoaded
        }

        // Step 1: Embed the query
        let queryEmbedding = try await embeddingService.embed(ragQuery.text)

        // Step 2: Search for relevant chunks
        let results = await vectorStore.search(
            queryEmbedding: queryEmbedding,
            topK: config.topK,
            threshold: config.similarityThreshold,
            labels: ragQuery.categoryLabels.isEmpty ? nil : ragQuery.categoryLabels
        )

        // Step 3: Format context
        let context = formatter.format(chunks: results)
        let systemPrompt = formatter.applyTemplate(config.systemPromptTemplate, context: context)

        // Step 4: Generate response
        let generationConfig = LLMGenerationConfig(
            maxTokens: config.maxGenerationTokens,
            temperature: config.temperature
        )

        let responseText = try await provider.generate(
            systemPrompt: systemPrompt,
            messages: ragQuery.conversationHistory,
            context: context,
            config: generationConfig
        )

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

        return RAGResponse(
            content: responseText,
            sources: sources,
            confidence: avgScore
        )
    }
}
