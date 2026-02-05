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
        var id: String { url ?? UUID().uuidString }
        var title: String?
        var url: String?
        var snippet: String?
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
