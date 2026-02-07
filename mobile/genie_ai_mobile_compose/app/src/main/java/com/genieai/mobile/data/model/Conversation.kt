package com.genieai.mobile.data.model

data class Conversation(
    val id: String = "",
    val title: String = "",
    val userId: String = "",
    val folderId: String? = null,
    val isStarred: Boolean = false,
    val isArchived: Boolean = false,
    val messageCount: Int = 0,
    val lastMessagePreview: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val messages: List<Message> = emptyList()
)
