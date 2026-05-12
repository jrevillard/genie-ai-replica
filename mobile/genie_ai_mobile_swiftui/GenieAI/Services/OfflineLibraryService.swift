// OfflineLibraryService.swift
// Manages the on-disk library of files downloaded from the GenieAI backend.
// Layout under <Documents>/OfflineLibrary/:
//   <file_id>.pdf              the downloaded file
//   <file_id>.json             sidecar metadata (RemoteFile + downloadedAt)
//
// Observable so the OfflineLibraryView can react to download/remove events.

import Foundation
import Observation

/// One entry in the offline library — pairs a RemoteFile with its on-disk
/// location and the timestamp it was downloaded.
struct OfflineLibraryItem: Identifiable, Hashable {
    let file: RemoteFile
    let pdfURL: URL
    let downloadedAt: Date

    var id: String { file.fileId }
}

/// Possible per-file states surfaced to the UI.
enum OfflineLibraryStatus: Equatable {
    case notDownloaded
    case downloading(progress: Double)  // 0...1 (we currently don't stream so this is mostly 0 or 1)
    case downloaded
    case failed(message: String)
}

@Observable
final class OfflineLibraryService {
    static let shared = OfflineLibraryService()

    /// All items currently on disk, keyed by file_id, sorted by downloadedAt desc.
    private(set) var items: [OfflineLibraryItem] = []

    /// Per-file UI status. Items missing from the map are implicitly `notDownloaded`.
    private(set) var statuses: [String: OfflineLibraryStatus] = [:]

    /// Hook for downstream side-effects: called whenever a file is successfully
    /// downloaded (with its on-disk URL and metadata). The LocalRAGIndexer wires
    /// itself in via this callback so a download triggers an index update.
    var onItemAdded: ((OfflineLibraryItem) async -> Void)?

    /// Hook called when a file is removed. The indexer uses it to drop the
    /// corresponding doc from the local vector store.
    var onItemRemoved: ((String) async -> Void)?

    private let remote: RemoteFilesService
    private let fileManager: FileManager
    private let libraryDirURL: URL

    init(
        remote: RemoteFilesService = .shared,
        fileManager: FileManager = .default
    ) {
        self.remote = remote
        self.fileManager = fileManager

        let docs = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        self.libraryDirURL = docs.appendingPathComponent("OfflineLibrary", isDirectory: true)

        try? fileManager.createDirectory(at: libraryDirURL, withIntermediateDirectories: true)

        // Populate `items` from whatever is already on disk so the UI is correct
        // before the first reload() call.
        reloadFromDisk()
    }

    // MARK: - Public API

    /// Re-scan disk and refresh `items`.
    func reloadFromDisk() {
        guard let contents = try? fileManager.contentsOfDirectory(
            at: libraryDirURL,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else {
            self.items = []
            self.statuses = [:]
            return
        }

        var rebuilt: [OfflineLibraryItem] = []
        var newStatuses: [String: OfflineLibraryStatus] = [:]

        for url in contents where url.pathExtension == "json" {
            let fileId = url.deletingPathExtension().lastPathComponent
            guard let data = try? Data(contentsOf: url),
                  let sidecar = try? JSONDecoder().decode(Sidecar.self, from: data) else {
                continue
            }
            let pdfURL = libraryDirURL.appendingPathComponent("\(fileId).pdf")
            guard fileManager.fileExists(atPath: pdfURL.path) else { continue }
            let item = OfflineLibraryItem(file: sidecar.file, pdfURL: pdfURL, downloadedAt: sidecar.downloadedAt)
            rebuilt.append(item)
            newStatuses[fileId] = .downloaded
        }

        rebuilt.sort { $0.downloadedAt > $1.downloadedAt }
        self.items = rebuilt
        self.statuses = newStatuses
    }

    /// Whether a particular file is already cached on disk.
    func isDownloaded(_ fileId: String) -> Bool {
        return statuses[fileId] == .downloaded
    }

    /// Status for a given file (the UI uses this directly).
    func status(for fileId: String) -> OfflineLibraryStatus {
        statuses[fileId] ?? .notDownloaded
    }

    /// Download a single file and persist it to disk. Idempotent: if the file
    /// is already on disk, just returns the existing item.
    @discardableResult
    func download(_ file: RemoteFile) async throws -> OfflineLibraryItem {
        if let existing = items.first(where: { $0.file.fileId == file.fileId }) {
            return existing
        }

        statuses[file.fileId] = .downloading(progress: 0)
        do {
            let data = try await remote.downloadFileData(fileId: file.fileId)

            let pdfURL = libraryDirURL.appendingPathComponent("\(file.fileId).pdf")
            try data.write(to: pdfURL, options: [.atomic])

            let now = Date()
            let sidecar = Sidecar(file: file, downloadedAt: now)
            let sidecarURL = libraryDirURL.appendingPathComponent("\(file.fileId).json")
            let sidecarData = try JSONEncoder().encode(sidecar)
            try sidecarData.write(to: sidecarURL, options: [.atomic])

            let item = OfflineLibraryItem(file: file, pdfURL: pdfURL, downloadedAt: now)
            var next = items.filter { $0.file.fileId != file.fileId }
            next.insert(item, at: 0)
            self.items = next
            self.statuses[file.fileId] = .downloaded

            await onItemAdded?(item)
            return item
        } catch {
            self.statuses[file.fileId] = .failed(message: error.localizedDescription)
            throw error
        }
    }

    /// Delete a file (and its sidecar) from disk.
    func remove(_ fileId: String) async throws {
        let pdfURL = libraryDirURL.appendingPathComponent("\(fileId).pdf")
        let sidecarURL = libraryDirURL.appendingPathComponent("\(fileId).json")
        try? fileManager.removeItem(at: pdfURL)
        try? fileManager.removeItem(at: sidecarURL)

        items.removeAll { $0.file.fileId == fileId }
        statuses[fileId] = .notDownloaded

        await onItemRemoved?(fileId)
    }

    /// Wipe the entire library.
    func removeAll() async throws {
        for item in items {
            try? fileManager.removeItem(at: item.pdfURL)
            let sidecar = libraryDirURL.appendingPathComponent("\(item.file.fileId).json")
            try? fileManager.removeItem(at: sidecar)
            await onItemRemoved?(item.file.fileId)
        }
        items = []
        statuses = [:]
    }

    // MARK: - Private

    private struct Sidecar: Codable {
        let file: RemoteFile
        let downloadedAt: Date
    }
}
