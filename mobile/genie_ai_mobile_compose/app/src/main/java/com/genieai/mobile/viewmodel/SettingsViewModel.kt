package com.genieai.mobile.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.genieai.mobile.data.repository.AuthRepository
import com.genieai.mobile.data.repository.UserRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SettingsUiState(
    val themeMode: String = "system", // "light", "dark", "system"
    val fontSize: Float = 1.0f,
    val emailNotifications: Boolean = true,
    val soundNotifications: Boolean = true,
    val animationsEnabled: Boolean = true,
    val hapticsEnabled: Boolean = true,
    val isLoading: Boolean = false,
    val error: String? = null,
    val successMessage: String? = null,
    val email: String = "",
    val userName: String = ""
)

class SettingsViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    private var userId: String = ""

    fun init(context: Context, userId: String, email: String, userName: String) {
        this.userId = userId
        val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
        _uiState.value = _uiState.value.copy(
            themeMode = prefs.getString("themeMode", "system") ?: "system",
            fontSize = prefs.getFloat("fontSize", 1.0f),
            emailNotifications = prefs.getBoolean("emailNotifications", true),
            soundNotifications = prefs.getBoolean("soundNotifications", true),
            animationsEnabled = prefs.getBoolean("animationsEnabled", true),
            hapticsEnabled = prefs.getBoolean("hapticsEnabled", true),
            email = email,
            userName = userName
        )
    }

    fun setThemeMode(context: Context, mode: String) {
        _uiState.value = _uiState.value.copy(themeMode = mode)
        context.getSharedPreferences("settings", Context.MODE_PRIVATE)
            .edit().putString("themeMode", mode).apply()
    }

    fun setFontSize(context: Context, size: Float) {
        _uiState.value = _uiState.value.copy(fontSize = size)
        context.getSharedPreferences("settings", Context.MODE_PRIVATE)
            .edit().putFloat("fontSize", size).apply()
    }

    fun setEmailNotifications(context: Context, enabled: Boolean) {
        _uiState.value = _uiState.value.copy(emailNotifications = enabled)
        context.getSharedPreferences("settings", Context.MODE_PRIVATE)
            .edit().putBoolean("emailNotifications", enabled).apply()
    }

    fun setSoundNotifications(context: Context, enabled: Boolean) {
        _uiState.value = _uiState.value.copy(soundNotifications = enabled)
        context.getSharedPreferences("settings", Context.MODE_PRIVATE)
            .edit().putBoolean("soundNotifications", enabled).apply()
    }

    fun setAnimationsEnabled(context: Context, enabled: Boolean) {
        _uiState.value = _uiState.value.copy(animationsEnabled = enabled)
        context.getSharedPreferences("settings", Context.MODE_PRIVATE)
            .edit().putBoolean("animationsEnabled", enabled).apply()
    }

    fun setHapticsEnabled(context: Context, enabled: Boolean) {
        _uiState.value = _uiState.value.copy(hapticsEnabled = enabled)
        context.getSharedPreferences("settings", Context.MODE_PRIVATE)
            .edit().putBoolean("hapticsEnabled", enabled).apply()
    }

    fun updateEmail(email: String, password: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = UserRepository.updateEmail(userId, email, password)
            result.fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        email = email,
                        successMessage = "Email updated successfully"
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

    fun resetUserData() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = UserRepository.resetUserData(userId)
            result.fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        successMessage = "User data has been reset"
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

    fun deleteAccount(password: String, reason: String?) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = UserRepository.deleteAccount(userId, password, reason)
            result.fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        successMessage = "Account deleted"
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

    fun initiatePasswordReset() {
        viewModelScope.launch {
            val result = AuthRepository.initiatePasswordReset(_uiState.value.email)
            result.fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        successMessage = "Password reset email sent"
                    )
                },
                onFailure = { /* Ignore */ }
            )
        }
    }

    fun clearMessages() {
        _uiState.value = _uiState.value.copy(error = null, successMessage = null)
    }
}
