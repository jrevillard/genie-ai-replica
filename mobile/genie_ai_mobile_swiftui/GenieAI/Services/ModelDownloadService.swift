// ModelDownloadService.swift
// Downloads a quantised Gemma GGUF into the app's Documents/Models/ so
// LocalRAGBridge can pick it up via its auto-detection. Bundling a 1.6 GB
// model in the .ipa is not viable for App Store distribution, so the
// recommended flow is "download on first run": the user sees a one-time
// progress bar in Settings, then the local RAG pipeline switches from
// FoundationModels (or the no-op fallback on older iOS) to llama.cpp.

import Foundation
import Observation
import os

@Observable
final class ModelDownloadService: NSObject {
    static let shared = ModelDownloadService()

    /// Where the model came from, if anywhere.
    enum Origin: Equatable {
        case missing
        case installed(URL)
    }

    /// Current download lifecycle for the UI.
    enum DownloadState: Equatable {
        case idle
        case downloading(received: Int64, expected: Int64)
        case finalizing
        case failed(message: String)
    }

    private(set) var origin: Origin = .missing
    private(set) var downloadState: DownloadState = .idle

    /// Fired after a successful download so callers (LocalRAGBridge) can
    /// re-initialize themselves with the new provider.
    var onModelInstalled: ((URL) async -> Void)?

    // MARK: - Public configuration

    /// Gemma 2 2B Instruct, Q4_K_M quantisation (~1.6 GB). Hosted on a
    /// public HuggingFace repo so no auth token is required.
    let modelFileName = "gemma-2-2b-it-Q4_K_M.gguf"
    let downloadURL = URL(string: "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf?download=true")!
    let displayName = "Gemma 2 2B Instruct (Q4_K_M)"
    let approxBytes: Int64 = 1_600_000_000

    // MARK: - Internals

    private static let logger = Logger(subsystem: "com.genieai", category: "model.download")
    @ObservationIgnored private let fm = FileManager.default
    @ObservationIgnored private var task: URLSessionDownloadTask?
    // @ObservationIgnored + non-lazy because @Observable rejects `lazy var`
    // (it can't wire its init-accessor through a backing closure). Build
    // the session in init() after `super.init()` so we can pass `self` as
    // the URLSessionDelegate.
    @ObservationIgnored private var session: URLSession!

    override init() {
        super.init()
        let cfg = URLSessionConfiguration.default
        cfg.waitsForConnectivity = true
        cfg.timeoutIntervalForResource = 60 * 60   // up to one hour for the full transfer
        self.session = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
        refreshOrigin()
    }

    // MARK: - Filesystem helpers

    private var modelsDirURL: URL {
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let dir = docs.appendingPathComponent("Models", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    var modelFileURL: URL {
        modelsDirURL.appendingPathComponent(modelFileName)
    }

    /// Update `origin` from disk state. Called at init and after the UI
    /// triggers a delete or download.
    func refreshOrigin() {
        if fm.fileExists(atPath: modelFileURL.path) {
            origin = .installed(modelFileURL)
        } else {
            origin = .missing
        }
    }

    var isInstalled: Bool {
        if case .installed = origin { return true }
        return false
    }

    var isBusy: Bool {
        switch downloadState {
        case .downloading, .finalizing: return true
        case .idle, .failed: return false
        }
    }

    // MARK: - Download lifecycle

    func startDownload() {
        guard !isBusy else { return }
        Self.logger.info("Starting download: \(self.downloadURL.absoluteString)")
        downloadState = .downloading(received: 0, expected: approxBytes)

        let request = URLRequest(url: downloadURL)
        let t = session.downloadTask(with: request)
        task = t
        t.resume()
    }

    func cancelDownload() {
        Self.logger.info("Cancelling download")
        task?.cancel()
        task = nil
        downloadState = .idle
    }

    func deleteModel() {
        Self.logger.info("Deleting model at \(self.modelFileURL.path)")
        try? fm.removeItem(at: modelFileURL)
        refreshOrigin()
    }
}

// MARK: - URLSession delegate

extension ModelDownloadService: URLSessionDownloadDelegate, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession,
                    downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        let expected = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : approxBytes
        Task { @MainActor in
            self.downloadState = .downloading(received: totalBytesWritten, expected: expected)
        }
    }

    func urlSession(_ session: URLSession,
                    downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        // Move the temp file to its final home synchronously inside the
        // delegate — `location` is deleted as soon as we return.
        let dest = modelFileURL
        do {
            try? fm.removeItem(at: dest)
            try fm.moveItem(at: location, to: dest)
            Self.logger.info("Model installed at \(dest.path)")
            Task { @MainActor in
                self.downloadState = .finalizing
                self.refreshOrigin()
                self.task = nil
                if let cb = self.onModelInstalled {
                    await cb(dest)
                }
                self.downloadState = .idle
            }
        } catch {
            Self.logger.error("Failed to move downloaded file: \(error.localizedDescription)")
            Task { @MainActor in
                self.downloadState = .failed(message: error.localizedDescription)
                self.task = nil
            }
        }
    }

    func urlSession(_ session: URLSession,
                    task: URLSessionTask,
                    didCompleteWithError error: Error?) {
        guard let error else { return }
        // Cancellation is not a "failure" worth surfacing — startDownload /
        // cancelDownload already updated state.
        let nsErr = error as NSError
        if nsErr.domain == NSURLErrorDomain && nsErr.code == NSURLErrorCancelled {
            return
        }
        Self.logger.error("Download failed: \(error.localizedDescription)")
        Task { @MainActor in
            self.downloadState = .failed(message: error.localizedDescription)
            self.task = nil
        }
    }
}
