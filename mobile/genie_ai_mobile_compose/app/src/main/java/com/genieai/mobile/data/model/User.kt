package com.genieai.mobile.data.model

data class User(
    val id: String = "",
    val loginName: String = "",
    val email: String = "",
    val firstName: String? = null,
    val lastName: String? = null,
    val role: String? = null,
    val isActive: Boolean = true,
    val lastLogin: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null
)
