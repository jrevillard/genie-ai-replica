package com.genieai.mobile.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.genieai.mobile.data.model.User
import com.genieai.mobile.data.remote.ApiService
import com.genieai.mobile.data.repository.AuthRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AuthUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val user: User? = null,
    val isLoggedIn: Boolean = false,
    // Register
    val usernameAvailable: Boolean? = null,
    val emailAvailable: Boolean? = null,
    val registrationSuccess: Boolean = false,
    // Password reset
    val resetRequestSent: Boolean = false,
    val resetSuccess: Boolean = false
)

class AuthViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    // ── Remembered credentials ─────────────────────────────────

    fun loadRememberedCredentials(context: Context): Pair<String, String>? {
        val prefs = context.getSharedPreferences("auth", Context.MODE_PRIVATE)
        val rememberMe = prefs.getBoolean("rememberMe", false)
        if (!rememberMe) return null
        val username = prefs.getString("username", null) ?: return null
        val password = prefs.getString("password", null) ?: return null
        return username to password
    }

    fun saveCredentials(context: Context, username: String, password: String, rememberMe: Boolean) {
        val prefs = context.getSharedPreferences("auth", Context.MODE_PRIVATE)
        prefs.edit().apply {
            putBoolean("rememberMe", rememberMe)
            if (rememberMe) {
                putString("username", username)
                putString("password", password)
            } else {
                remove("username")
                remove("password")
            }
            apply()
        }
    }

    // ── Fetch Current User (re-hydrate after navigation) ──────

    fun fetchCurrentUser() {
        if (_uiState.value.user != null) return // already loaded
        if (ApiService.getToken() == null) return // no token
        viewModelScope.launch {
            val result = AuthRepository.fetchCurrentUser()
            result.fold(
                onSuccess = { user ->
                    _uiState.value = _uiState.value.copy(
                        user = user,
                        isLoggedIn = true
                    )
                },
                onFailure = { /* Token invalid or expired — stay on current screen */ }
            )
        }
    }

    // ── Login ──────────────────────────────────────────────────

    fun login(loginName: String, password: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = AuthRepository.login(loginName, password)
            result.fold(
                onSuccess = { user ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        user = user,
                        isLoggedIn = true,
                        error = null
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message ?: "Login failed"
                    )
                }
            )
        }
    }

    fun logout() {
        viewModelScope.launch {
            AuthRepository.logout()
            _uiState.value = AuthUiState()
        }
    }

    // ── Registration ───────────────────────────────────────────

    fun register(loginName: String, email: String, password: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = AuthRepository.register(loginName, email, password)
            result.fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        registrationSuccess = true,
                        error = null
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message ?: "Registration failed"
                    )
                }
            )
        }
    }

    fun checkUsernameAvailability(username: String) {
        viewModelScope.launch {
            val result = AuthRepository.checkUsernameAvailability(username)
            result.fold(
                onSuccess = { available ->
                    _uiState.value = _uiState.value.copy(usernameAvailable = available)
                },
                onFailure = { /* Silently ignore */ }
            )
        }
    }

    fun checkEmailAvailability(email: String) {
        viewModelScope.launch {
            val result = AuthRepository.checkEmailAvailability(email)
            result.fold(
                onSuccess = { available ->
                    _uiState.value = _uiState.value.copy(emailAvailable = available)
                },
                onFailure = { /* Silently ignore */ }
            )
        }
    }

    // ── Password Reset ─────────────────────────────────────────

    fun initiatePasswordReset(email: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = AuthRepository.initiatePasswordReset(email)
            result.fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        resetRequestSent = true
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message ?: "Reset request failed"
                    )
                }
            )
        }
    }

    fun confirmPasswordReset(token: String, newPassword: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = AuthRepository.confirmPasswordReset(token, newPassword)
            result.fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        resetSuccess = true
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message ?: "Reset failed"
                    )
                }
            )
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
