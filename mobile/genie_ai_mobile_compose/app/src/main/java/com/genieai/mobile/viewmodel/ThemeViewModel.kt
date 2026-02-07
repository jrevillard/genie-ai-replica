package com.genieai.mobile.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class ThemeViewModel : ViewModel() {

    private val _isDarkMode = MutableStateFlow<Boolean?>(null) // null = system
    val isDarkMode: StateFlow<Boolean?> = _isDarkMode.asStateFlow()

    private val _themeMode = MutableStateFlow("system")
    val themeMode: StateFlow<String> = _themeMode.asStateFlow()

    fun init(context: Context) {
        val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
        val mode = prefs.getString("themeMode", "system") ?: "system"
        _themeMode.value = mode
        _isDarkMode.value = when (mode) {
            "light" -> false
            "dark" -> true
            else -> null
        }
    }

    fun setThemeMode(mode: String) {
        _themeMode.value = mode
        _isDarkMode.value = when (mode) {
            "light" -> false
            "dark" -> true
            else -> null
        }
    }
}
