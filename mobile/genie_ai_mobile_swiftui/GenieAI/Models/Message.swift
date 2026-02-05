// Message.swift
// Message model for chat conversations

import Foundation

struct Message: Codable, Identifiable, Equatable {
    let id: String
    var role: MessageRole
    var content: String
    var timestamp: Date
    var queryId: String?
    var feedbackSubmitted: Bool?
    var metadata: MessageMetadata?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case role
        case content
        case timestamp
        case queryId
        case feedbackSubmitted
        case metadata
    }

    init(
        id: String = UUID().uuidString,
        role: MessageRole,
        content: String,
        timestamp: Date = Date(),
        queryId: String? = nil,
        feedbackSubmitted: Bool? = nil,
        metadata: MessageMetadata? = nil
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.timestamp = timestamp
        self.queryId = queryId
        self.feedbackSubmitted = feedbackSubmitted
        self.metadata = metadata
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
struct QueryResponse: Codable {
    let id: String?
    let response: String?
    let content: String?
    let sources: [MessageMetadata.DocumentSource]?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case response
        case content
        case sources
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
