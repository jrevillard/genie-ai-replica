// LocalRAGIndexer.swift
// Glue between OfflineLibraryService (on-disk PDFs) and LocalRAGBridge
// (in-memory vector store). Extracts text from each downloaded PDF using
// PDFKit and indexes it into the local RAG pipeline, preserving the labels
// that were attached on the server so the offline retriever can apply the
// same category filters as the online retriever.

import Foundation
import PDFKit
import Observation
import os

@Observable
final class LocalRAGIndexer {
    private static let logger = Logger(subsystem: "com.genieai", category: "localrag.indexer")

    /// Total number of distinct documents currently indexed (best-effort —
    /// tracked locally because LocalRAG doesn't expose per-document
    /// enumeration).
    private(set) var indexedFileIds: Set<String> = []

    /// True while a bulk reindex (e.g. at app startup) is in progress.
    private(set) var isReindexing = false

    private let bridge: LocalRAGBridge
    private let library: OfflineLibraryService

    init(bridge: LocalRAGBridge, library: OfflineLibraryService) {
        self.bridge = bridge
        self.library = library
        wireLibraryHooks()
    }

    /// Re-index every cached PDF currently in the library. Called once after
    /// the LLM model is ready (LocalRAGBridge.isReady becomes true), since
    /// LocalRAG's vector store is in-memory only and is empty after each app
    /// launch.
    func reindexLibrary() async {
        guard bridge.isReady else {
            Self.logger.warning("Skipping reindex — bridge not ready")
            return
        }
        isReindexing = true
        defer { isReindexing = false }

        // Snapshot to avoid mutating while iterating.
        let items = library.items
        Self.logger.info("Re-indexing offline library: \(items.count) item(s)")

        await bridge.clearIndex()
        indexedFileIds = []

        for item in items {
            await indexItem(item)
        }

        let chunkCount = await bridge.indexedChunkCount
        Self.logger.info("Re-index complete: \(self.indexedFileIds.count) document(s), \(chunkCount) chunk(s)")
    }

    // MARK: - Private

    private func wireLibraryHooks() {
        library.onItemAdded = { [weak self] item in
            await self?.indexItem(item)
        }
        library.onItemRemoved = { [weak self] fileId in
            guard let self else { return }
            await self.bridge.removeDocument(id: fileId)
            self.indexedFileIds.remove(fileId)
        }
    }

    private func indexItem(_ item: OfflineLibraryItem) async {
        guard let text = Self.extractText(from: item.pdfURL), !text.isEmpty else {
            Self.logger.error("Could not extract text from \(item.pdfURL.lastPathComponent)")
            return
        }

        let metadata = Self.buildLabelMetadata(labels: item.file.labels)

        do {
            try await bridge.indexDocument(
                id: item.file.fileId,
                title: item.file.fileName,
                content: text,
                metadata: metadata
            )
            indexedFileIds.insert(item.file.fileId)
            Self.logger.info("Indexed \(item.file.fileName) (\(text.count) chars, labels=\(item.file.labels.joined(separator: ",")))")
        } catch {
            Self.logger.error("Failed to index \(item.file.fileName): \(error.localizedDescription)")
        }
    }

    /// Convert a labels array into the dictionary shape LocalRAG expects.
    /// LocalRAG flattens metadata.values into chunk labels, so we use distinct
    /// keys per label to preserve all of them.
    private static func buildLabelMetadata(labels: [String]) -> [String: String] {
        var dict: [String: String] = [:]
        for (i, label) in labels.enumerated() {
            dict["label_\(i)"] = label
        }
        return dict
    }

    private static func extractText(from url: URL) -> String? {
        guard let pdf = PDFDocument(url: url) else { return nil }
        var pieces: [String] = []
        for i in 0..<pdf.pageCount {
            if let page = pdf.page(at: i), let text = page.string {
                pieces.append(text)
            }
        }
        return pieces.joined(separator: "\n\n")
    }
}
