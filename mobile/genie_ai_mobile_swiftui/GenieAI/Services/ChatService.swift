// ChatService.swift
// Service for chat queries and feedback

import Foundation

@Observable
class ChatService {
    private let api = APIService.shared

    private(set) var isLoading = false
    private(set) var error: String?

    // MARK: - Query Submission

    func submitQuery(
        sessionId: String,
        messages: [Message],
        userId: String,
        categoryId: String? = nil,
        contextLabels: String? = nil,
        language: String? = nil
    ) async throws -> QueryResponse {
        isLoading = true
        error = nil

        defer { isLoading = false }

        var payload: [String: Any] = [
            "sessionId": sessionId,
            "messages": messages.map { ["role": $0.role.rawValue, "content": $0.content] },
            "userId": userId,
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ]

        if let language = language, !language.isEmpty {
            payload["language"] = language
        }

        if (categoryId != nil && !categoryId!.isEmpty) || (contextLabels != nil && !contextLabels!.isEmpty) {
            var context: [String: String] = [:]
            if let categoryId = categoryId {
                context["categoryId"] = categoryId
                payload["categoryId"] = categoryId
            }
            if let contextLabels = contextLabels {
                context["labels"] = contextLabels
            }
            payload["context"] = context
        }

        print("[ChatService] Submitting query: \(payload)")

        let data = try await api.post("queries", data: payload)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = JSONDecoder.flexibleDateStrategy

        return try decoder.decode(QueryResponse.self, from: data)
    }

    // MARK: - Offline Query

    func submitOfflineQuery(
        messages: [Message],
        localRAG: LocalRAGBridge,
        contextLabels: [String]
    ) async throws -> QueryResponse {
        guard let lastUserMessage = messages.last(where: { $0.role == .user }) else {
            throw NSError(domain: "ChatService", code: -1, userInfo: [NSLocalizedDescriptionKey: "No user message found"])
        }

        return try await localRAG.submitQuery(
            query: lastUserMessage.actualContent ?? lastUserMessage.content,
            conversationHistory: messages,
            contextLabels: contextLabels
        )
    }

    // MARK: - Feedback

    func submitFeedback(
        queryId: String,
        userId: String,
        rating: Int,
        comment: String?,
        isPositive: Bool
    ) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        // Clean userId (remove 'users/' prefix if present)
        let cleanUserId = userId.replacingOccurrences(of: "users/", with: "")

        var payload: [String: Any] = [
            "userId": cleanUserId,
            "rating": rating,
            "isPositive": isPositive
        ]

        if let comment = comment, !comment.isEmpty {
            payload["comment"] = comment
        }

        print("[ChatService] Submitting feedback for query \(queryId): \(payload)")

        let _ = try await api.post("queries/\(queryId)/feedback", data: payload)
    }
}
