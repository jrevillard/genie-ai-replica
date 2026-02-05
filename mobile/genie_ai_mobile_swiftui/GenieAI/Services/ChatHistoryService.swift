// ChatHistoryService.swift
// Service for managing conversations and folders

import Foundation

@Observable
class ChatHistoryService {
    private let api = APIService.shared

    private(set) var conversations: [Conversation] = []
    private(set) var folders: [Folder] = []
    private(set) var isLoading = false
    private(set) var error: String?

    // MARK: - Conversations

    func getUserConversations(userId: String, options: [String: String]? = nil) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        var params = ["userId": userId]
        if let options = options {
            params.merge(options) { _, new in new }
        }

        let data = try await api.get("chat/conversations", params: params)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let response = try decoder.decode(ConversationsResponse.self, from: data)
        conversations = response.conversations ?? []
    }

    func createConversation(title: String, userId: String, sessionId: String) async throws -> Conversation {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let payload: [String: Any] = [
            "title": title,
            "userId": userId,
            "sessionId": sessionId
        ]

        let data = try await api.post("chat/conversations", data: payload)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let conversation = try decoder.decode(Conversation.self, from: data)
        conversations.insert(conversation, at: 0)
        return conversation
    }

    func updateConversation(id: String, updates: [String: Any]) async throws -> Conversation {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let data = try await api.patch("chat/conversations/\(id)", data: updates)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let conversation = try decoder.decode(Conversation.self, from: data)

        if let index = conversations.firstIndex(where: { $0.id == id }) {
            conversations[index] = conversation
        }

        return conversation
    }

    func deleteConversation(id: String, userId: String) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let _ = try await api.delete("chat/conversations/\(id)", params: ["userId": userId])
        conversations.removeAll { $0.id == id }
    }

    func addMessage(conversationId: String, message: Message, userId: String) async throws {
        let payload: [String: Any] = [
            "role": message.role.rawValue,
            "content": message.content,
            "userId": userId,
            "timestamp": ISO8601DateFormatter().string(from: message.timestamp)
        ]

        let _ = try await api.post("chat/conversations/\(conversationId)/messages", data: payload)
    }

    // MARK: - Folders

    func getUserFolders(userId: String) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let data = try await api.get("chat/folders", params: ["userId": userId])

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        folders = try decoder.decode([Folder].self, from: data)
    }

    func createFolder(name: String, userId: String) async throws -> Folder {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let payload: [String: Any] = [
            "name": name,
            "userId": userId
        ]

        let data = try await api.post("chat/folders", data: payload)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let folder = try decoder.decode(Folder.self, from: data)
        folders.append(folder)
        return folder
    }

    func updateFolder(id: String, name: String) async throws -> Folder {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let data = try await api.patch("chat/folders/\(id)", data: ["name": name])

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let folder = try decoder.decode(Folder.self, from: data)

        if let index = folders.firstIndex(where: { $0.id == id }) {
            folders[index] = folder
        }

        return folder
    }

    func deleteFolder(id: String, userId: String) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let _ = try await api.delete("chat/folders/\(id)", params: ["userId": userId])
        folders.removeAll { $0.id == id }
    }

    func addConversationToFolder(folderId: String, conversationId: String, userId: String) async throws {
        let _ = try await api.post("chat/folders/\(folderId)/conversations/\(conversationId)", data: ["userId": userId])

        // Update local state
        if let convIndex = conversations.firstIndex(where: { $0.id == conversationId }) {
            conversations[convIndex].folderId = folderId
        }
    }

    // MARK: - Helpers

    func getStarredConversations() -> [Conversation] {
        conversations.filter { $0.isStarred }
    }

    func getArchivedConversations() -> [Conversation] {
        conversations.filter { $0.isArchived }
    }

    func getConversationsInFolder(_ folderId: String) -> [Conversation] {
        conversations.filter { $0.folderId == folderId }
    }

    func getUnfolderedConversations() -> [Conversation] {
        conversations.filter { $0.folderId == nil && !$0.isArchived }
    }
}
