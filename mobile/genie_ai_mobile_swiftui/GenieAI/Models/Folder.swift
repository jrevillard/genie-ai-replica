// Folder.swift
// Folder model for organizing conversations

import Foundation

struct Folder: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var userId: String?
    var description: String?
    var conversationIds: [String]?
    var isDefault: Bool
    var isArchived: Bool
    var color: String?
    var icon: String?
    var parentFolderId: String?
    var order: Int
    var conversationCount: Int
    var createdAt: Date
    var updatedAt: Date

    private enum CodingKeys: String, CodingKey {
        case underscoreId = "_id"
        case underscoreKey = "_key"
        case plainId = "id"
        case name
        case description
        case userId
        case conversationIds
        case isDefault
        case isArchived
        case color
        case icon
        case parentFolderId
        case order
        case conversationCount
        case childFolderCount
        case created
        case updated
        case createdAt
        case updatedAt
        case lastAccessedAt
    }

    init(
        id: String = UUID().uuidString,
        name: String,
        userId: String? = nil,
        conversationIds: [String]? = nil,
        isDefault: Bool = false,
        isArchived: Bool = false,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.userId = userId
        self.conversationIds = conversationIds
        self.isDefault = isDefault
        self.isArchived = isArchived
        self.color = nil
        self.icon = nil
        self.parentFolderId = nil
        self.order = 0
        self.conversationCount = 0
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Flutter: typedFolder['_key'] ?? typedFolder['id']
        if let key = try container.decodeIfPresent(String.self, forKey: .underscoreKey) {
            self.id = key
        } else if let uid = try container.decodeIfPresent(String.self, forKey: .underscoreId) {
            self.id = uid.replacingOccurrences(of: "folders/", with: "")
        } else if let pid = try container.decodeIfPresent(String.self, forKey: .plainId) {
            self.id = pid
        } else {
            self.id = UUID().uuidString
        }

        self.name = try container.decodeIfPresent(String.self, forKey: .name) ?? ""
        self.description = try container.decodeIfPresent(String.self, forKey: .description)
        self.userId = try container.decodeIfPresent(String.self, forKey: .userId)
        self.conversationIds = try container.decodeIfPresent([String].self, forKey: .conversationIds)
        self.isDefault = try container.decodeIfPresent(Bool.self, forKey: .isDefault) ?? false
        self.isArchived = try container.decodeIfPresent(Bool.self, forKey: .isArchived) ?? false
        self.color = try container.decodeIfPresent(String.self, forKey: .color)
        self.icon = try container.decodeIfPresent(String.self, forKey: .icon)
        self.parentFolderId = try container.decodeIfPresent(String.self, forKey: .parentFolderId)
        self.order = try container.decodeIfPresent(Int.self, forKey: .order) ?? 0
        self.conversationCount = try container.decodeIfPresent(Int.self, forKey: .conversationCount) ?? 0

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
        try container.encode(id, forKey: .underscoreKey)
        try container.encode(name, forKey: .name)
        try container.encodeIfPresent(userId, forKey: .userId)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
    }

    static func == (lhs: Folder, rhs: Folder) -> Bool {
        lhs.id == rhs.id
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
