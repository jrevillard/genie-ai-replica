package com.genieai.mobile.data.repository

import com.genieai.mobile.data.model.Message
import com.genieai.mobile.data.model.MessageRole
import com.genieai.mobile.data.model.RelatedDocument
import com.genieai.mobile.data.remote.ApiService

object ChatRepository {

    suspend fun submitQuery(
        sessionId: String,
        messages: List<Map<String, String>>,
        userId: String,
        categoryId: String? = null,
        contextLabels: String? = null,
        language: String = "en"
    ): Result<Message> {
        return try {
            val payload = mutableMapOf<String, Any?>(
                "sessionId" to sessionId,
                "messages" to messages,
                "userId" to userId,
                "timestamp" to java.time.Instant.now().toString()
            )
            if (language.isNotEmpty()) {
                payload["language"] = language
            }

            // Context object matching backend schema
            if (!categoryId.isNullOrEmpty() || !contextLabels.isNullOrEmpty()) {
                val context = mutableMapOf<String, Any?>()
                categoryId?.let { context["categoryId"] = it }
                contextLabels?.let { context["labels"] = it }
                payload["context"] = context
                // Also set categoryId at top level (backend accepts both)
                categoryId?.let { payload["categoryId"] = it }
            }

            val response = ApiService.post("queries", payload)

            if (response.isSuccess && response.body != null) {
                val body = response.body
                val answer = body.get("answer")?.asString
                    ?: body.get("response")?.asString ?: ""
                val queryId = body.get("queryId")?.asString
                    ?: body.get("_key")?.asString
                    ?: body.get("_id")?.asString ?: ""

                val docs = mutableListOf<RelatedDocument>()
                body.getAsJsonArray("relatedDocuments")?.forEach { docEl ->
                    val doc = docEl.asJsonObject
                    val labels = mutableListOf<String>()
                    (doc.getAsJsonArray("labels")
                        ?: doc.getAsJsonArray("tags")
                        ?: doc.getAsJsonArray("keywords"))?.forEach { labels.add(it.asString) }

                    docs.add(
                        RelatedDocument(
                            id = doc.get("id")?.asString
                                ?: doc.get("_id")?.asString
                                ?: doc.get("fileId")?.asString ?: "",
                            name = doc.get("name")?.asString
                                ?: doc.get("document_name")?.asString
                                ?: doc.get("title")?.asString ?: "",
                            fileName = doc.get("fileName")?.asString
                                ?: doc.get("file_name")?.asString ?: "",
                            confidence = doc.get("confidence")?.asDouble
                                ?: doc.get("score")?.asDouble ?: 0.0,
                            labels = labels
                        )
                    )
                }

                val message = Message(
                    id = queryId,
                    content = answer,
                    role = MessageRole.ASSISTANT,
                    relatedDocuments = docs
                )
                Result.success(message)
            } else {
                val serverMsg = response.body?.get("message")?.asString
                    ?: response.body?.get("error")?.asString
                    ?: response.rawBody
                    ?: "Unknown error"
                Result.failure(Exception("Query failed (${response.statusCode}): $serverMsg"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun submitFeedback(
        queryId: String,
        userId: String,
        rating: Int,
        comment: String? = null
    ): Result<Unit> {
        return try {
            val cleanUserId = userId.removePrefix("users/")
            val payload = mutableMapOf<String, Any?>(
                "userId" to cleanUserId,
                "rating" to rating
            )
            comment?.let { payload["comment"] = it }

            // Feedback endpoint includes queryId in the URL path
            val response = ApiService.post("queries/$queryId/feedback", payload)
            if (response.isSuccess) {
                Result.success(Unit)
            } else {
                Result.failure(Exception("Feedback submission failed"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
