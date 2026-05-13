// RemoteFilesService.swift
// Wraps GET /api/files (list) and GET /api/files/:id/download (raw bytes).
// Returns typed models. Uses APIService for auth/headers and base URL.

import Foundation

/// Metadata for a single file as returned by GET /api/files.
struct RemoteFile: Identifiable, Hashable, Codable {
    let fileId: String
    let fileName: String
    let fileSize: Int?
    let labels: [String]
    let status: String?
    let chunkCount: Int?

    var id: String { fileId }

    private enum CodingKeys: String, CodingKey {
        case fileId = "file_id"
        case fileName = "file_name"
        case fileSize = "file_size"
        case labels
        case dataprep
        case chunkCount = "chunk_count"
    }

    private struct DataprepWrapper: Codable {
        let status: String?
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        fileId = try c.decode(String.self, forKey: .fileId)
        fileName = try c.decodeIfPresent(String.self, forKey: .fileName) ?? fileId
        fileSize = try c.decodeIfPresent(Int.self, forKey: .fileSize)
        labels = (try c.decodeIfPresent([String].self, forKey: .labels)) ?? []
        let dp = try c.decodeIfPresent(DataprepWrapper.self, forKey: .dataprep)
        status = dp?.status
        chunkCount = try c.decodeIfPresent(Int.self, forKey: .chunkCount)
    }

    init(fileId: String, fileName: String, fileSize: Int? = nil, labels: [String] = [], status: String? = nil, chunkCount: Int? = nil) {
        self.fileId = fileId
        self.fileName = fileName
        self.fileSize = fileSize
        self.labels = labels
        self.status = status
        self.chunkCount = chunkCount
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(fileId, forKey: .fileId)
        try c.encode(fileName, forKey: .fileName)
        try c.encodeIfPresent(fileSize, forKey: .fileSize)
        try c.encode(labels, forKey: .labels)
        try c.encodeIfPresent(chunkCount, forKey: .chunkCount)
        if let status {
            try c.encode(DataprepWrapper(status: status), forKey: .dataprep)
        }
    }
}

/// HTTP wrapper around the backend's file endpoints.
actor RemoteFilesService {
    static let shared = RemoteFilesService()

    private let api: APIService

    init(api: APIService = .shared) {
        self.api = api
    }

    /// Page through `/api/files`. The backend caps `limit` at 50 (Joi schema
    /// `getFilesSchema`), and only ingested files are usable offline so we
    /// push that filter server-side via `dataprepStatus`. Pages are walked
    /// until the server reports we have them all.
    func listFiles(maxPages: Int = 20) async throws -> [RemoteFile] {
        var page = 1
        var collected: [RemoteFile] = []
        while page <= maxPages {
            let data = try await api.get(
                "files",
                params: [
                    "page": "\(page)",
                    "limit": "50",
                    "dataprepStatus": "ingested"
                ]
            )
            let envelope = try JSONDecoder().decode(FilesListEnvelope.self, from: data)
            collected.append(contentsOf: envelope.data)
            let total = envelope.pagination?.total ?? collected.count
            if collected.count >= total || envelope.data.isEmpty { break }
            page += 1
        }
        return collected
    }

    /// Download raw bytes (PDF) for a single file.
    func downloadFileData(fileId: String) async throws -> Data {
        return try await api.get("files/\(fileId)/download")
    }

    private struct FilesListEnvelope: Decodable {
        let success: Bool
        let data: [RemoteFile]
        let pagination: Pagination?
    }

    private struct Pagination: Decodable {
        let total: Int?
        let page: Int?
        let limit: Int?
    }
}
