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

    private enum CodingKeys: String, CodingKey {
        case underscoreId = "_id"
        case underscoreKey = "_key"
        case plainId = "id"
        case title
        case userId
        case sessionId
        case messages
        case isStarred
        case isArchived
        case folderId
        case category
        case created
        case updated
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

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Flutter strips "conversations/" prefix from _id
        if let uid = try container.decodeIfPresent(String.self, forKey: .underscoreId) {
            self.id = uid.replacingOccurrences(of: "conversations/", with: "")
        } else if let key = try container.decodeIfPresent(String.self, forKey: .underscoreKey) {
            self.id = key
        } else if let pid = try container.decodeIfPresent(String.self, forKey: .plainId) {
            self.id = pid
        } else {
            self.id = UUID().uuidString
        }

        self.title = try container.decodeIfPresent(String.self, forKey: .title) ?? "Untitled"
        self.userId = try container.decodeIfPresent(String.self, forKey: .userId) ?? ""
        self.sessionId = try container.decodeIfPresent(String.self, forKey: .sessionId) ?? ""
        self.messages = try container.decodeIfPresent([Message].self, forKey: .messages)
        self.isStarred = try container.decodeIfPresent(Bool.self, forKey: .isStarred) ?? false
        self.isArchived = try container.decodeIfPresent(Bool.self, forKey: .isArchived) ?? false
        self.folderId = try container.decodeIfPresent(String.self, forKey: .folderId)

        // API returns "created"/"updated", not "createdAt"/"updatedAt"
        if let date = try container.decodeIfPresent(Date.self, forKey: .created) {
            self.createdAt = date
        } else if let date = try container.decodeIfPresent(Date.self, forKey: .createdAt) {
            self.createdAt = date
        } else {
            self.createdAt = Date()
        }

        if let date = try container.decodeIfPresent(Date.self, forKey: .updated) {
            self.updatedAt = date
        } else if let date = try container.decodeIfPresent(Date.self, forKey: .updatedAt) {
            self.updatedAt = date
        } else {
            self.updatedAt = Date()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .underscoreId)
        try container.encode(title, forKey: .title)
        try container.encode(userId, forKey: .userId)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encodeIfPresent(messages, forKey: .messages)
        try container.encode(isStarred, forKey: .isStarred)
        try container.encode(isArchived, forKey: .isArchived)
        try container.encodeIfPresent(folderId, forKey: .folderId)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
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
        lastMessage?.content ?? String(localized: "No preview available")
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
