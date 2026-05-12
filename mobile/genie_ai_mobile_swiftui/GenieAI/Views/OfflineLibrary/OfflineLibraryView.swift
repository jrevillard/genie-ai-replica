// OfflineLibraryView.swift
// Browse the server's RAG files and download them for offline use. The
// OfflineLibraryService persists downloads to disk and the LocalRAGIndexer
// keeps the in-memory vector store in sync so offline chats can search them.

import SwiftUI

struct OfflineLibraryView: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(OfflineLibraryService.self) private var library

    @State private var remoteFiles: [RemoteFile] = []
    @State private var isLoading = false
    @State private var loadError: String?

    private let remote = RemoteFilesService.shared

    var body: some View {
        Group {
            if isLoading && remoteFiles.isEmpty && library.items.isEmpty {
                loadingState
            } else if let loadError, remoteFiles.isEmpty && library.items.isEmpty {
                errorState(loadError)
            } else {
                contentList
            }
        }
        .task { await refresh() }
        .refreshable { await refresh() }
    }

    // MARK: - States

    private var loadingState: some View {
        VStack(spacing: theme.spacingMD) {
            ProgressView()
            Text("Loading library…")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: theme.spacingMD) {
            Image(systemName: "wifi.exclamationmark")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("Could not load remote files")
                .font(.headline)
            Text(message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, theme.spacingXL)
            Button("Try again") {
                Task { await refresh() }
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var contentList: some View {
        let downloaded = library.items.map(\.file)
        let downloadedIds = Set(downloaded.map(\.fileId))
        let available = remoteFiles.filter { !downloadedIds.contains($0.fileId) }

        List {
            if !downloaded.isEmpty {
                Section {
                    ForEach(downloaded) { file in
                        row(for: file)
                    }
                } header: {
                    Text("Downloaded (\(downloaded.count))")
                }
            }

            if !available.isEmpty {
                Section {
                    ForEach(available) { file in
                        row(for: file)
                    }
                } header: {
                    Text("Available")
                }
            }

            if downloaded.isEmpty && available.isEmpty {
                emptyState
            }
        }
        .listStyle(.insetGrouped)
    }

    private var emptyState: some View {
        VStack(spacing: theme.spacingMD) {
            Image(systemName: "tray")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("No files in the library yet")
                .font(.headline)
            Text("Documents you ingest on the server will appear here for offline download.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, theme.spacingXL)
        .listRowBackground(Color.clear)
    }

    // MARK: - Row

    @ViewBuilder
    private func row(for file: RemoteFile) -> some View {
        let status = library.status(for: file.fileId)
        HStack(spacing: theme.spacingMD) {
            Image(systemName: "doc.text.fill")
                .font(.title2)
                .foregroundStyle(theme.primaryColor)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 4) {
                Text(file.fileName)
                    .font(.subheadline)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    if let size = file.fileSize {
                        Text(formatBytes(size))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    if !file.labels.isEmpty {
                        Text(file.labels.joined(separator: " · "))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
            Spacer(minLength: theme.spacingSM)

            actionButton(file: file, status: status)
        }
        .contentShape(Rectangle())
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func actionButton(file: RemoteFile, status: OfflineLibraryStatus) -> some View {
        switch status {
        case .downloaded:
            Button(role: .destructive) {
                Task {
                    try? await library.remove(file.fileId)
                }
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .hapticOnTap(theme: theme)
            .accessibilityLabel("Remove from device")

        case .downloading:
            ProgressView()
                .controlSize(.small)

        case .failed:
            Button {
                Task {
                    try? await library.download(file)
                }
            } label: {
                Image(systemName: "exclamationmark.arrow.triangle.2.circlepath")
                    .foregroundStyle(.red)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Retry")

        case .notDownloaded:
            Button {
                Task {
                    try? await library.download(file)
                }
            } label: {
                Image(systemName: "arrow.down.circle")
                    .font(.title3)
            }
            .buttonStyle(.borderless)
            .hapticOnTap(theme: theme)
            .accessibilityLabel("Download")
        }
    }

    // MARK: - Helpers

    private func refresh() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }

        // Always reload disk state first so the UI shows what's already cached
        // even if the network call fails.
        library.reloadFromDisk()

        do {
            remoteFiles = try await remote.listFiles()
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func formatBytes(_ bytes: Int) -> String {
        let fmt = ByteCountFormatter()
        fmt.allowedUnits = [.useKB, .useMB, .useGB]
        fmt.countStyle = .file
        return fmt.string(fromByteCount: Int64(bytes))
    }
}
