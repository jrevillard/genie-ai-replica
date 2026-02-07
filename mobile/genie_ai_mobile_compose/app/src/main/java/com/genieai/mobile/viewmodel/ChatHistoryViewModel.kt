package com.genieai.mobile.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.genieai.mobile.data.model.Conversation
import com.genieai.mobile.data.model.Folder
import com.genieai.mobile.data.repository.ChatHistoryRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ChatHistoryUiState(
    val conversations: List<Conversation> = emptyList(),
    val folders: List<Folder> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val selectedTab: ChatHistoryTab = ChatHistoryTab.ALL,
    val searchQuery: String = "",
    val selectedFolderId: String? = null
)

enum class ChatHistoryTab { ALL, FOLDERS, STARRED, ARCHIVED }

class ChatHistoryViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(ChatHistoryUiState())
    val uiState: StateFlow<ChatHistoryUiState> = _uiState.asStateFlow()

    private var userId: String = ""

    fun loadConversations(userId: String) {
        this.userId = userId
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)

            val convResult = ChatHistoryRepository.getUserConversations(userId)
            val folderResult = ChatHistoryRepository.getUserFolders(userId)

            convResult.fold(
                onSuccess = { conversations ->
                    _uiState.value = _uiState.value.copy(
                        conversations = conversations,
                        isLoading = false
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message
                    )
                }
            )

            folderResult.fold(
                onSuccess = { folders ->
                    _uiState.value = _uiState.value.copy(folders = folders)
                },
                onFailure = { /* Silently ignore */ }
            )
        }
    }

    fun setTab(tab: ChatHistoryTab) {
        _uiState.value = _uiState.value.copy(selectedTab = tab)
    }

    fun setSearchQuery(query: String) {
        _uiState.value = _uiState.value.copy(searchQuery = query)
    }

    fun selectFolder(folderId: String?) {
        _uiState.value = _uiState.value.copy(selectedFolderId = folderId)
    }

    fun getFilteredConversations(): List<Conversation> {
        val state = _uiState.value
        var filtered = state.conversations

        // Filter by tab
        filtered = when (state.selectedTab) {
            ChatHistoryTab.ALL -> filtered.filter { !it.isArchived }
            ChatHistoryTab.STARRED -> filtered.filter { it.isStarred && !it.isArchived }
            ChatHistoryTab.ARCHIVED -> filtered.filter { it.isArchived }
            ChatHistoryTab.FOLDERS -> {
                state.selectedFolderId?.let { fid ->
                    filtered.filter { it.folderId == fid }
                } ?: filtered
            }
        }

        // Filter by search
        if (state.searchQuery.isNotBlank()) {
            filtered = filtered.filter {
                it.title.contains(state.searchQuery, ignoreCase = true)
            }
        }

        return filtered.sortedByDescending { it.updatedAt ?: it.createdAt }
    }

    fun toggleStar(conversationId: String) {
        viewModelScope.launch {
            val conv = _uiState.value.conversations.find { it.id == conversationId } ?: return@launch
            val newStarred = !conv.isStarred
            ChatHistoryRepository.updateConversation(conversationId, mapOf("isStarred" to newStarred))
            _uiState.value = _uiState.value.copy(
                conversations = _uiState.value.conversations.map {
                    if (it.id == conversationId) it.copy(isStarred = newStarred) else it
                }
            )
        }
    }

    fun toggleArchive(conversationId: String) {
        viewModelScope.launch {
            val conv = _uiState.value.conversations.find { it.id == conversationId } ?: return@launch
            val newArchived = !conv.isArchived
            ChatHistoryRepository.updateConversation(conversationId, mapOf("isArchived" to newArchived))
            _uiState.value = _uiState.value.copy(
                conversations = _uiState.value.conversations.map {
                    if (it.id == conversationId) it.copy(isArchived = newArchived) else it
                }
            )
        }
    }

    fun renameConversation(conversationId: String, newTitle: String) {
        viewModelScope.launch {
            ChatHistoryRepository.updateConversation(conversationId, mapOf("title" to newTitle))
            _uiState.value = _uiState.value.copy(
                conversations = _uiState.value.conversations.map {
                    if (it.id == conversationId) it.copy(title = newTitle) else it
                }
            )
        }
    }

    fun deleteConversation(conversationId: String) {
        viewModelScope.launch {
            ChatHistoryRepository.deleteConversation(conversationId, userId)
            _uiState.value = _uiState.value.copy(
                conversations = _uiState.value.conversations.filter { it.id != conversationId }
            )
        }
    }

    fun moveConversation(conversationId: String, folderId: String) {
        viewModelScope.launch {
            ChatHistoryRepository.addConversationToFolder(folderId, conversationId, userId)
            _uiState.value = _uiState.value.copy(
                conversations = _uiState.value.conversations.map {
                    if (it.id == conversationId) it.copy(folderId = folderId) else it
                }
            )
        }
    }

    fun createFolder(name: String) {
        viewModelScope.launch {
            val result = ChatHistoryRepository.createFolder(userId, name)
            result.fold(
                onSuccess = { folder ->
                    _uiState.value = _uiState.value.copy(
                        folders = _uiState.value.folders + folder
                    )
                },
                onFailure = { /* Handle error */ }
            )
        }
    }

    fun deleteFolder(folderId: String) {
        viewModelScope.launch {
            ChatHistoryRepository.deleteFolder(folderId, userId)
            _uiState.value = _uiState.value.copy(
                folders = _uiState.value.folders.filter { it.id != folderId },
                selectedFolderId = if (_uiState.value.selectedFolderId == folderId) null
                    else _uiState.value.selectedFolderId
            )
        }
    }

    fun refresh() {
        if (userId.isNotBlank()) {
            loadConversations(userId)
        }
    }
}
