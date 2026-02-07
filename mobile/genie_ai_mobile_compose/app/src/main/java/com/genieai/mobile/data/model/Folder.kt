package com.genieai.mobile.data.model

data class Folder(
    val id: String = "",
    val name: String = "",
    val userId: String = "",
    val conversationCount: Int = 0,
    val createdAt: String? = null,
    val updatedAt: String? = null
)
