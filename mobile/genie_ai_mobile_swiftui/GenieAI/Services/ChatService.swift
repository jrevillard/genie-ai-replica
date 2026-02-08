// ChatService.swift
// Service for chat queries and feedback

import Foundation
import os

@Observable
class ChatService {
    private let api = APIService.shared
    private static let logger = Logger(subsystem: "com.genieai", category: "llm.remote")

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

        Self.logger.info("Remote query: sessionId=\(sessionId, privacy: .private), messages=\(messages.count), categoryId=\(categoryId ?? "nil"), labels=\(contextLabels ?? "nil"), language=\(language ?? "nil")")
        for (i, msg) in messages.enumerated() {
            Self.logger.debug("Remote request message[\(i)] role=\(msg.role.rawValue): \(msg.content)")
        }

        let clock = ContinuousClock()
        let startTime = clock.now

        do {
            let data = try await api.post("queries", data: payload)

            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = JSONDecoder.flexibleDateStrategy

            let response = try decoder.decode(QueryResponse.self, from: data)

            let duration = clock.now - startTime
            let durationMs = Int(duration.components.seconds * 1000 + duration.components.attoseconds / 1_000_000_000_000_000)
            let contentLength = response.response?.count ?? response.content?.count ?? 0
            Self.logger.info("Remote response: id=\(response.id ?? "nil", privacy: .private), confidence=\(response.confidence ?? 0, format: .fixed(precision: 2)), sources=\(response.sources?.count ?? 0), contentLength=\(contentLength), duration=\(durationMs)ms")
            Self.logger.debug("Remote response text: \(response.response ?? response.content ?? "")")

            return response
        } catch {
            let duration = clock.now - startTime
            let durationMs = Int(duration.components.seconds * 1000 + duration.components.attoseconds / 1_000_000_000_000_000)
            Self.logger.error("Remote query failed after \(durationMs)ms: \(error.localizedDescription)")
            throw error
        }
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

        Self.logger.info("Routing to offline: messages=\(messages.count), labels=\(contextLabels.joined(separator: ","))")

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

        Self.logger.info("Submitting feedback: queryId=\(queryId, privacy: .private), rating=\(rating), isPositive=\(isPositive)")

        let _ = try await api.post("queries/\(queryId)/feedback", data: payload)
    }
}
