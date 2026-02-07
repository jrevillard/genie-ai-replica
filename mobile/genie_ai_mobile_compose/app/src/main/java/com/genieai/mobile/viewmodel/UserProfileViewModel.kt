package com.genieai.mobile.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.genieai.mobile.data.repository.UserRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ProfileUiState(
    val profileData: Map<String, Any?> = emptyMap(),
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null,
    val saveSuccess: Boolean = false,
    val selectedTabIndex: Int = 0,
    val hasChanges: Boolean = false
)

class UserProfileViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(ProfileUiState())
    val uiState: StateFlow<ProfileUiState> = _uiState.asStateFlow()

    private var userId: String = ""
    private val editedFields = mutableMapOf<String, Any?>()

    fun loadProfile(userId: String) {
        this.userId = userId
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = UserRepository.getProfile(userId)
            result.fold(
                onSuccess = { data ->
                    _uiState.value = _uiState.value.copy(
                        profileData = data,
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
        }
    }

    fun updateField(key: String, value: Any?) {
        editedFields[key] = value
        _uiState.value = _uiState.value.copy(
            profileData = _uiState.value.profileData + (key to value),
            hasChanges = true
        )
    }

    fun getField(key: String): String {
        return _uiState.value.profileData[key]?.toString() ?: ""
    }

    fun selectTab(index: Int) {
        _uiState.value = _uiState.value.copy(selectedTabIndex = index)
    }

    fun saveProfile() {
        if (editedFields.isEmpty()) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSaving = true, error = null, saveSuccess = false)
            val result = UserRepository.updateProfile(userId, editedFields)
            result.fold(
                onSuccess = {
                    editedFields.clear()
                    _uiState.value = _uiState.value.copy(
                        isSaving = false,
                        saveSuccess = true,
                        hasChanges = false
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        isSaving = false,
                        error = e.message
                    )
                }
            )
        }
    }

    fun discardChanges() {
        editedFields.clear()
        _uiState.value = _uiState.value.copy(hasChanges = false)
        if (userId.isNotBlank()) loadProfile(userId)
    }

    fun clearSaveSuccess() {
        _uiState.value = _uiState.value.copy(saveSuccess = false)
    }

    companion object {
        val PROFILE_TABS = listOf(
            "Personal Identification Data",
            "Civil Registration & Documentation",
            "Address & Residency Information",
            "Identity & Travel Documents",
            "Health & Medical Records",
            "Employment & Economic Data",
            "Education & Academic Records",
            "Financial & Tax Data",
            "Social Security & Welfare",
            "Criminal & Legal Records",
            "Transportation & Mobility",
            "Civic & Political Participation"
        )

        val PROFILE_TABS_SHORT = listOf(
            "Personal", "Civil", "Address", "Identity", "Health",
            "Employment", "Education", "Financial", "Social",
            "Criminal", "Transport", "Civic"
        )
    }
}
