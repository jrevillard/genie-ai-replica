// Conversation.swift
// Conversation model for chat history

import Foundation

struct Conversation: Codable, Identifiable, Equatable {
    let id: String
    var title: String
    var userId: String
    var sessionId: String
    var messages: [Message]?
    var isStarred: Bool
    var isArchived: Bool
    var folderId: String?
    var createdAt: Date
    var updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case title
        case userId
        case sessionId
        case messages
        case isStarred
        case isArchived
        case folderId
        case createdAt
        case updatedAt
    }

    init(
        id: String = UUID().uuidString,
        title: String,
        userId: String,
        sessionId: String,
        messages: [Message]? = nil,
        isStarred: Bool = false,
        isArchived: Bool = false,
        folderId: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.userId = userId
        self.sessionId = sessionId
        self.messages = messages
        self.isStarred = isStarred
        self.isArchived = isArchived
        self.folderId = folderId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    static func == (lhs: Conversation, rhs: Conversation) -> Bool {
        lhs.id == rhs.id
    }

    var messageCount: Int {
        messages?.count ?? 0
    }

    var lastMessage: Message? {
        messages?.last
    }

    var preview: String {
        lastMessage?.content ?? tr("sidebar.noPreview")
    }
}

// Response from getUserConversations
struct ConversationsResponse: Codable {
    let conversations: [Conversation]?
    let total: Int?
    let page: Int?
    let limit: Int?
}

// Create conversation request
struct CreateConversationRequest: Codable {
    let title: String
    let userId: String
    let sessionId: String
}

// Update conversation request
struct UpdateConversationRequest: Codable {
    var title: String?
    var isStarred: Bool?
    var isArchived: Bool?
    var folderId: String?
}
