package com.genieai.mobile.data.model

data class Message(
    val id: String = "",
    val conversationId: String = "",
    val content: String = "",
    val role: MessageRole = MessageRole.USER,
    val timestamp: String? = null,
    val feedbackRating: Int? = null,
    val feedbackComment: String? = null,
    val relatedDocuments: List<RelatedDocument> = emptyList()
)

enum class MessageRole {
    USER, ASSISTANT, SYSTEM
}

data class RelatedDocument(
    val id: String = "",
    val name: String = "",
    val fileName: String = "",
    val confidence: Double = 0.0,
    val labels: List<String> = emptyList()
)
