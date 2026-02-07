package com.genieai.mobile.viewmodel

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.genieai.mobile.data.model.Message
import com.genieai.mobile.data.model.MessageRole
import com.genieai.mobile.data.model.RelatedDocument
import com.genieai.mobile.data.repository.ChatHistoryRepository
import com.genieai.mobile.data.repository.ChatRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.Locale
import java.util.UUID

data class ChatUiState(
    val messages: List<Message> = emptyList(),
    val isLoading: Boolean = false,
    val isThinking: Boolean = false,
    val error: String? = null,
    val currentConversationId: String? = null,
    val currentConversationTitle: String? = null,
    val selectedCategoryId: String? = null,
    val selectedCategoryName: String? = null,
    val contextLabels: List<String> = emptyList(),
    val relatedDocuments: List<RelatedDocument> = emptyList(),
    val hasUnsavedChanges: Boolean = false,
    val sessionId: String = UUID.randomUUID().toString()
)

class ChatViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private var userId: String = ""

    /** Current device language code (e.g., "en", "fr", "ar") */
    private val currentLanguage: String
        get() = Locale.getDefault().language

    fun setUserId(id: String) {
        Log.d("ChatViewModel", "setUserId: '$id'")
        userId = id
    }

    fun sendMessage(content: String) {
        if (content.isBlank()) return
        if (userId.isBlank()) {
            Log.w("ChatViewModel", "sendMessage ignored — userId is blank (user not loaded yet)")
            return
        }

        val userMessage = Message(
            id = UUID.randomUUID().toString(),
            content = content,
            role = MessageRole.USER,
            timestamp = java.time.Instant.now().toString()
        )

        val currentState = _uiState.value
        _uiState.value = currentState.copy(
            messages = currentState.messages + userMessage,
            isThinking = true,
            hasUnsavedChanges = true,
            error = null
        )

        viewModelScope.launch {
            val messagesPayload = _uiState.value.messages.map { msg ->
                mapOf(
                    "role" to msg.role.name.lowercase(),
                    "content" to msg.content
                )
            }

            val result = ChatRepository.submitQuery(
                sessionId = currentState.sessionId,
                messages = messagesPayload,
                userId = userId,
                categoryId = currentState.selectedCategoryId,
                contextLabels = currentState.contextLabels.takeIf { it.isNotEmpty() }?.joinToString(","),
                language = currentLanguage
            )

            result.fold(
                onSuccess = { botMessage ->
                    val updated = _uiState.value
                    _uiState.value = updated.copy(
                        messages = updated.messages + botMessage,
                        isThinking = false,
                        relatedDocuments = mergeDocuments(updated.relatedDocuments, botMessage.relatedDocuments)
                    )
                },
                onFailure = { e ->
                    Log.e("ChatViewModel", "Query failed: ${e.message}", e)
                    val errorMsg = Message(
                        id = UUID.randomUUID().toString(),
                        content = "Sorry, I encountered an error. Please try again.",
                        role = MessageRole.ASSISTANT
                    )
                    val updated = _uiState.value
                    _uiState.value = updated.copy(
                        messages = updated.messages + errorMsg,
                        isThinking = false,
                        error = e.message
                    )
                }
            )
        }
    }

    fun sendQuickHelp(visibleText: String, hiddenPrompt: String, categoryId: String?) {
        categoryId?.let { setCategory(it, null, null) }

        val userMessage = Message(
            id = UUID.randomUUID().toString(),
            content = visibleText,
            role = MessageRole.USER,
            timestamp = java.time.Instant.now().toString()
        )

        val currentState = _uiState.value
        _uiState.value = currentState.copy(
            messages = currentState.messages + userMessage,
            isThinking = true,
            hasUnsavedChanges = true
        )

        viewModelScope.launch {
            val messagesPayload = listOf(
                mapOf("role" to "user", "content" to hiddenPrompt)
            )

            val result = ChatRepository.submitQuery(
                sessionId = currentState.sessionId,
                messages = messagesPayload,
                userId = userId,
                categoryId = categoryId,
                language = currentLanguage
            )

            result.fold(
                onSuccess = { botMessage ->
                    val updated = _uiState.value
                    _uiState.value = updated.copy(
                        messages = updated.messages + botMessage,
                        isThinking = false,
                        relatedDocuments = mergeDocuments(updated.relatedDocuments, botMessage.relatedDocuments)
                    )
                },
                onFailure = { e ->
                    Log.e("ChatViewModel", "Quick help failed: ${e.message}", e)
                    val errorMsg = Message(
                        id = UUID.randomUUID().toString(),
                        content = "Sorry, I encountered an error. Please try again.",
                        role = MessageRole.ASSISTANT
                    )
                    val updated = _uiState.value
                    _uiState.value = updated.copy(
                        messages = updated.messages + errorMsg,
                        isThinking = false,
                        error = e.message
                    )
                }
            )
        }
    }

    /** Set category context from service tree selection */
    fun setCategory(categoryId: String?, categoryName: String?, contextLabels: List<String>?) {
        _uiState.value = _uiState.value.copy(
            selectedCategoryId = categoryId,
            selectedCategoryName = categoryName ?: contextLabels?.joinToString(", "),
            contextLabels = contextLabels ?: listOfNotNull(categoryName)
        )
    }

    fun clearContext() {
        _uiState.value = _uiState.value.copy(
            selectedCategoryId = null,
            selectedCategoryName = null,
            contextLabels = emptyList()
        )
    }

    fun startNewChat() {
        _uiState.value = ChatUiState(sessionId = UUID.randomUUID().toString())
    }

    fun loadConversation(conversationId: String, title: String, messages: List<Message>) {
        _uiState.value = _uiState.value.copy(
            currentConversationId = conversationId,
            currentConversationTitle = title,
            messages = messages,
            hasUnsavedChanges = false
        )
    }

    fun saveConversation(title: String) {
        viewModelScope.launch {
            val conversationId = _uiState.value.currentConversationId
            if (conversationId != null) {
                ChatHistoryRepository.updateConversation(conversationId, mapOf("title" to title))
            } else {
                val result = ChatHistoryRepository.createConversation(userId, title)
                result.fold(
                    onSuccess = { conv ->
                        _uiState.value = _uiState.value.copy(
                            currentConversationId = conv.id,
                            currentConversationTitle = title,
                            hasUnsavedChanges = false
                        )
                        for (msg in _uiState.value.messages) {
                            ChatHistoryRepository.addMessage(
                                conv.id,
                                msg.content,
                                msg.role.name.lowercase(),
                                userId
                            )
                        }
                    },
                    onFailure = { e ->
                        Log.e("ChatViewModel", "Save conversation failed: ${e.message}", e)
                    }
                )
            }
        }
    }

    fun submitFeedback(queryId: String, rating: Int, comment: String?) {
        viewModelScope.launch {
            ChatRepository.submitFeedback(queryId, userId, rating, comment)
        }
    }

    /** Merge new documents into existing list, deduplicating by id */
    private fun mergeDocuments(existing: List<RelatedDocument>, new: List<RelatedDocument>): List<RelatedDocument> {
        if (new.isEmpty()) return existing
        val existingIds = existing.map { it.id }.toSet()
        return existing + new.filter { it.id !in existingIds }
    }
}
