package com.genieai.mobile.data.repository

import com.genieai.mobile.data.model.Conversation
import com.genieai.mobile.data.model.Folder
import com.genieai.mobile.data.remote.ApiService
import com.google.gson.JsonObject

object ChatHistoryRepository {

    // ── ID Helpers ────────────────────────────────────────────

    /** Extract ID from ArangoDB response: prefer _key, then _id (strip collection prefix), then id */
    private fun extractId(obj: JsonObject, collectionPrefix: String = ""): String {
        obj.get("_key")?.asString?.let { if (it.isNotEmpty()) return it }
        obj.get("_id")?.asString?.let { id ->
            if (id.isNotEmpty()) return if (collectionPrefix.isNotEmpty()) id.removePrefix(collectionPrefix) else id
        }
        return obj.get("id")?.asString ?: ""
    }

    /** Extract date field: backend uses 'created'/'updated', fallback to 'createdAt'/'updatedAt' */
    private fun extractDate(obj: JsonObject, primary: String, fallback: String): String? {
        return obj.get(primary)?.let { if (!it.isJsonNull) it.asString else null }
            ?: obj.get(fallback)?.let { if (!it.isJsonNull) it.asString else null }
    }

    // ── Conversations ───────────────────────────────────────────

    suspend fun getUserConversations(userId: String): Result<List<Conversation>> {
        return try {
            val response = ApiService.get("chat/conversations", mapOf("userId" to userId))
            if (response.isSuccess && response.body != null) {
                val conversations = mutableListOf<Conversation>()
                val array = response.body.getAsJsonArray("conversations")
                    ?: response.body.getAsJsonArray("data")
                    ?: (if (response.body.isJsonArray) response.body.asJsonArray else null)
                array?.forEach { el ->
                    val obj = el.asJsonObject
                    conversations.add(
                        Conversation(
                            id = extractId(obj, "conversations/"),
                            title = obj.get("title")?.asString ?: "Untitled",
                            userId = obj.get("userId")?.asString ?: userId,
                            folderId = obj.get("folderId")?.let { if (!it.isJsonNull) it.asString else null },
                            isStarred = obj.get("isStarred")?.asBoolean ?: false,
                            isArchived = obj.get("isArchived")?.asBoolean ?: false,
                            messageCount = obj.get("messageCount")?.asInt ?: 0,
                            lastMessagePreview = obj.get("lastMessagePreview")?.let { if (!it.isJsonNull) it.asString else null },
                            createdAt = extractDate(obj, "created", "createdAt"),
                            updatedAt = extractDate(obj, "updated", "updatedAt")
                        )
                    )
                }
                Result.success(conversations)
            } else {
                Result.failure(Exception("Failed to load conversations"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun createConversation(userId: String, title: String): Result<Conversation> {
        return try {
            val response = ApiService.post("chat/conversations", mapOf(
                "userId" to userId,
                "title" to title
            ))
            if (response.isSuccess && response.body != null) {
                val obj = response.body
                Result.success(
                    Conversation(
                        id = extractId(obj, "conversations/"),
                        title = obj.get("title")?.asString ?: title,
                        userId = userId
                    )
                )
            } else {
                Result.failure(Exception("Failed to create conversation"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun updateConversation(
        conversationId: String,
        updates: Map<String, Any?>
    ): Result<Unit> {
        return try {
            val response = ApiService.patch("chat/conversations/$conversationId", updates)
            if (response.isSuccess) Result.success(Unit)
            else Result.failure(Exception("Failed to update conversation"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteConversation(conversationId: String, userId: String): Result<Unit> {
        return try {
            val response = ApiService.delete(
                "chat/conversations/$conversationId",
                mapOf("userId" to userId)
            )
            if (response.isSuccess) Result.success(Unit)
            else Result.failure(Exception("Failed to delete conversation"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun addMessage(
        conversationId: String,
        content: String,
        role: String,
        userId: String
    ): Result<Unit> {
        return try {
            // Backend expects 'sender' not 'role', with values "user" or "assistant"
            val response = ApiService.post("chat/conversations/$conversationId/messages", mapOf(
                "content" to content,
                "sender" to role,
                "userId" to userId
            ))
            if (response.isSuccess) Result.success(Unit)
            else Result.failure(Exception("Failed to add message"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ── Folders ─────────────────────────────────────────────────

    suspend fun getUserFolders(userId: String): Result<List<Folder>> {
        return try {
            val response = ApiService.get("chat/folders", mapOf("userId" to userId))
            if (response.isSuccess && response.body != null) {
                val folders = mutableListOf<Folder>()
                // Backend may return array directly or wrapped in "folders"/"data"
                val array = response.body.getAsJsonArray("folders")
                    ?: response.body.getAsJsonArray("data")
                    ?: (if (response.body.isJsonArray) response.body.asJsonArray else null)
                array?.forEach { el ->
                    val obj = el.asJsonObject
                    folders.add(
                        Folder(
                            id = extractId(obj, "folders/"),
                            name = obj.get("name")?.asString ?: "",
                            userId = obj.get("userId")?.asString ?: userId,
                            conversationCount = obj.get("conversationCount")?.asInt ?: 0,
                            createdAt = extractDate(obj, "created", "createdAt"),
                            updatedAt = extractDate(obj, "updated", "updatedAt")
                        )
                    )
                }
                Result.success(folders)
            } else {
                Result.failure(Exception("Failed to load folders"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun createFolder(userId: String, name: String): Result<Folder> {
        return try {
            val response = ApiService.post("chat/folders", mapOf(
                "userId" to userId,
                "name" to name
            ))
            if (response.isSuccess && response.body != null) {
                val obj = response.body
                Result.success(
                    Folder(
                        id = extractId(obj, "folders/"),
                        name = obj.get("name")?.asString ?: name,
                        userId = userId
                    )
                )
            } else {
                Result.failure(Exception("Failed to create folder"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun updateFolder(folderId: String, name: String): Result<Unit> {
        return try {
            val response = ApiService.patch("chat/folders/$folderId", mapOf("name" to name))
            if (response.isSuccess) Result.success(Unit)
            else Result.failure(Exception("Failed to update folder"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteFolder(folderId: String, userId: String): Result<Unit> {
        return try {
            val response = ApiService.delete(
                "chat/folders/$folderId",
                mapOf("userId" to userId)
            )
            if (response.isSuccess) Result.success(Unit)
            else Result.failure(Exception("Failed to delete folder"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun addConversationToFolder(folderId: String, conversationId: String, userId: String): Result<Unit> {
        return try {
            // Backend endpoint: POST /chat/folders/{folderId}/conversations/{conversationId}
            val response = ApiService.post(
                "chat/folders/$folderId/conversations/$conversationId",
                mapOf("userId" to userId)
            )
            if (response.isSuccess) Result.success(Unit)
            else Result.failure(Exception("Failed to move conversation"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
