// Message.swift
// Message model for chat conversations

import Foundation

struct Message: Codable, Identifiable, Equatable {
    let id: String
    var role: MessageRole
    var content: String
    var actualContent: String?
    var timestamp: Date
    var queryId: String?
    var feedbackSubmitted: Bool?
    var isSaved: Bool?
    var confidence: Double?
    var metadata: MessageMetadata?

    private enum CodingKeys: String, CodingKey {
        case underscoreId = "_id"
        case underscoreKey = "_key"
        case plainId = "id"
        case role
        case sender  // API returns "sender", Flutter normalizes to "role"
        case content
        case actualContent
        case timestamp
        case queryId
        case feedbackSubmitted
        case isSaved
        case confidence
        case metadata
    }

    init(
        id: String = UUID().uuidString,
        role: MessageRole,
        content: String,
        actualContent: String? = nil,
        timestamp: Date = Date(),
        queryId: String? = nil,
        feedbackSubmitted: Bool? = nil,
        isSaved: Bool? = nil,
        confidence: Double? = nil,
        metadata: MessageMetadata? = nil
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.actualContent = actualContent
        self.timestamp = timestamp
        self.queryId = queryId
        self.feedbackSubmitted = feedbackSubmitted
        self.isSaved = isSaved
        self.confidence = confidence
        self.metadata = metadata
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // ID: _id, _key, or id
        if let uid = try container.decodeIfPresent(String.self, forKey: .underscoreId) {
            self.id = uid
        } else if let key = try container.decodeIfPresent(String.self, forKey: .underscoreKey) {
            self.id = key
        } else if let pid = try container.decodeIfPresent(String.self, forKey: .plainId) {
            self.id = pid
        } else {
            self.id = UUID().uuidString
        }

        // Role: API returns "sender" (user/assistant), Flutter normalizes to "role"
        if let role = try container.decodeIfPresent(MessageRole.self, forKey: .role) {
            self.role = role
        } else if let sender = try container.decodeIfPresent(String.self, forKey: .sender) {
            self.role = sender == "user" ? .user : .assistant
        } else {
            self.role = .assistant
        }

        self.content = try container.decodeIfPresent(String.self, forKey: .content) ?? ""
        self.actualContent = try container.decodeIfPresent(String.self, forKey: .actualContent)
        self.timestamp = try container.decodeIfPresent(Date.self, forKey: .timestamp) ?? Date()
        self.queryId = try container.decodeIfPresent(String.self, forKey: .queryId)
        self.feedbackSubmitted = try container.decodeIfPresent(Bool.self, forKey: .feedbackSubmitted)
        self.isSaved = try container.decodeIfPresent(Bool.self, forKey: .isSaved)
        self.confidence = try container.decodeIfPresent(Double.self, forKey: .confidence)
        self.metadata = try container.decodeIfPresent(MessageMetadata.self, forKey: .metadata)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .underscoreId)
        try container.encode(role, forKey: .role)
        try container.encode(content, forKey: .content)
        try container.encodeIfPresent(actualContent, forKey: .actualContent)
        try container.encode(timestamp, forKey: .timestamp)
        try container.encodeIfPresent(queryId, forKey: .queryId)
        try container.encodeIfPresent(feedbackSubmitted, forKey: .feedbackSubmitted)
        try container.encodeIfPresent(isSaved, forKey: .isSaved)
        try container.encodeIfPresent(confidence, forKey: .confidence)
        try container.encodeIfPresent(metadata, forKey: .metadata)
    }

    static func == (lhs: Message, rhs: Message) -> Bool {
        lhs.id == rhs.id
    }
}

enum MessageRole: String, Codable {
    case user
    case assistant
    case system

    var isUser: Bool {
        self == .user
    }

    var isAssistant: Bool {
        self == .assistant
    }
}

struct MessageMetadata: Codable {
    var categoryId: String?
    var contextLabels: String?
    var language: String?
    var sources: [DocumentSource]?

    struct DocumentSource: Codable, Identifiable {
        var id: String { documentId ?? url ?? UUID().uuidString }
        var title: String?
        var url: String?
        var snippet: String?
        var fileName: String?
        var fileType: String?
        var fileSize: Int?
        var score: Double?
        var documentId: String?
        var categoryLabel: [String]?
        var serviceLabels: [String]?
        var labels: [String]?

        private enum CodingKeys: String, CodingKey {
            case title, url, snippet
            case fileName = "fileName"
            case documentName = "document_name"
            case fileType = "fileType"
            case mimeType = "mimeType"
            case type
            case fileSize = "fileSize"
            case size
            case contentLength = "contentLength"
            case score, confidence
            case documentId = "document_id"
            case docId = "id"
            case docKey = "_id"
            case fileId = "fileId"
            case categoryLabel, serviceLabels, labels
            case tags, keywords
        }

        init(
            title: String? = nil,
            url: String? = nil,
            snippet: String? = nil,
            fileName: String? = nil,
            fileType: String? = nil,
            fileSize: Int? = nil,
            score: Double? = nil,
            documentId: String? = nil,
            categoryLabel: [String]? = nil,
            serviceLabels: [String]? = nil,
            labels: [String]? = nil
        ) {
            self.title = title
            self.url = url
            self.snippet = snippet
            self.fileName = fileName
            self.fileType = fileType
            self.fileSize = fileSize
            self.score = score
            self.documentId = documentId
            self.categoryLabel = categoryLabel
            self.serviceLabels = serviceLabels
            self.labels = labels
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)

            self.title = try container.decodeIfPresent(String.self, forKey: .title)
            self.url = try container.decodeIfPresent(String.self, forKey: .url)
            self.snippet = try container.decodeIfPresent(String.self, forKey: .snippet)

            // fileName: try fileName, then document_name
            self.fileName = try container.decodeIfPresent(String.self, forKey: .fileName)
                ?? container.decodeIfPresent(String.self, forKey: .documentName)

            // fileType: try fileType, mimeType, type
            self.fileType = try container.decodeIfPresent(String.self, forKey: .fileType)
                ?? container.decodeIfPresent(String.self, forKey: .mimeType)
                ?? container.decodeIfPresent(String.self, forKey: .type)

            // fileSize: try fileSize, size, contentLength (as Int or String)
            if let fs = try container.decodeIfPresent(Int.self, forKey: .fileSize) {
                self.fileSize = fs
            } else if let s = try container.decodeIfPresent(Int.self, forKey: .size) {
                self.fileSize = s
            } else if let cl = try container.decodeIfPresent(Int.self, forKey: .contentLength) {
                self.fileSize = cl
            } else {
                self.fileSize = nil
            }

            // score: try score, then confidence
            self.score = try container.decodeIfPresent(Double.self, forKey: .score)
                ?? container.decodeIfPresent(Double.self, forKey: .confidence)

            // documentId: try document_id, id, _id, fileId
            self.documentId = try container.decodeIfPresent(String.self, forKey: .documentId)
                ?? container.decodeIfPresent(String.self, forKey: .docId)
                ?? container.decodeIfPresent(String.self, forKey: .docKey)
                ?? container.decodeIfPresent(String.self, forKey: .fileId)

            // Labels
            self.categoryLabel = try container.decodeIfPresent([String].self, forKey: .categoryLabel)
            self.serviceLabels = try container.decodeIfPresent([String].self, forKey: .serviceLabels)
            self.labels = try container.decodeIfPresent([String].self, forKey: .labels)
                ?? container.decodeIfPresent([String].self, forKey: .tags)
                ?? container.decodeIfPresent([String].self, forKey: .keywords)
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encodeIfPresent(title, forKey: .title)
            try container.encodeIfPresent(url, forKey: .url)
            try container.encodeIfPresent(snippet, forKey: .snippet)
            try container.encodeIfPresent(fileName, forKey: .fileName)
            try container.encodeIfPresent(fileType, forKey: .fileType)
            try container.encodeIfPresent(fileSize, forKey: .fileSize)
            try container.encodeIfPresent(score, forKey: .score)
            try container.encodeIfPresent(documentId, forKey: .documentId)
            try container.encodeIfPresent(categoryLabel, forKey: .categoryLabel)
            try container.encodeIfPresent(serviceLabels, forKey: .serviceLabels)
            try container.encodeIfPresent(labels, forKey: .labels)
        }
    }
}

// Query request for sending messages
struct QueryRequest: Codable {
    let sessionId: String
    let messages: [[String: String]]
    let userId: String
    let timestamp: String
    var language: String?
    var context: QueryContext?
    var categoryId: String?

    struct QueryContext: Codable {
        var categoryId: String?
        var labels: String?
    }
}

// Query response from the API
struct QueryResponse: Decodable {
    let id: String?
    let response: String?
    let content: String?
    let sources: [MessageMetadata.DocumentSource]?
    let confidence: Double?

    private enum CodingKeys: String, CodingKey {
        case underscoreId = "_id"
        case underscoreKey = "_key"
        case plainId = "id"
        case response
        case content
        case sources
        case confidence
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decodeIfPresent(String.self, forKey: .underscoreId)
            ?? container.decodeIfPresent(String.self, forKey: .underscoreKey)
            ?? container.decodeIfPresent(String.self, forKey: .plainId)
        self.response = try container.decodeIfPresent(String.self, forKey: .response)
        self.content = try container.decodeIfPresent(String.self, forKey: .content)
        self.sources = try container.decodeIfPresent([MessageMetadata.DocumentSource].self, forKey: .sources)
        self.confidence = try container.decodeIfPresent(Double.self, forKey: .confidence)
    }

    var messageContent: String {
        response ?? content ?? ""
    }
}

// Feedback request
struct FeedbackRequest: Codable {
    let queryId: String
    let userId: String
    let rating: Int
    let comment: String?
    let isPositive: Bool
}
