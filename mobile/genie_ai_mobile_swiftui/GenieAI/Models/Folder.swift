// Folder.swift
// Folder model for organizing conversations

import Foundation

struct Folder: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var userId: String
    var conversationIds: [String]?
    var createdAt: Date
    var updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name
        case userId
        case conversationIds
        case createdAt
        case updatedAt
    }

    init(
        id: String = UUID().uuidString,
        name: String,
        userId: String,
        conversationIds: [String]? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.userId = userId
        self.conversationIds = conversationIds
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    static func == (lhs: Folder, rhs: Folder) -> Bool {
        lhs.id == rhs.id
    }

    var conversationCount: Int {
        conversationIds?.count ?? 0
    }
}

// Create folder request
struct CreateFolderRequest: Codable {
    let name: String
    let userId: String
}

// Update folder request
struct UpdateFolderRequest: Codable {
    var name: String?
}
