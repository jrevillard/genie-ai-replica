package com.genieai.mobile.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.genieai.mobile.data.model.ServiceCategory
import com.genieai.mobile.data.repository.ServiceTreeRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Tracks a single selected service item */
data class ServiceSelection(
    val id: String,
    val name: String,
    val categoryId: String
)

data class ServiceTreeUiState(
    val categories: List<ServiceCategory> = emptyList(),
    val searchResults: List<ServiceCategory> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val searchQuery: String = "",
    val expandedIds: Set<String> = emptySet(),
    val selectedServices: List<ServiceSelection> = emptyList()
)

class ServiceTreeViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(ServiceTreeUiState())
    val uiState: StateFlow<ServiceTreeUiState> = _uiState.asStateFlow()

    init {
        loadCategories()
    }

    fun loadCategories(locale: String = "en") {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = ServiceTreeRepository.getAllCategories(locale)
            result.fold(
                onSuccess = { categories ->
                    _uiState.value = _uiState.value.copy(
                        categories = categories,
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

    fun search(query: String) {
        _uiState.value = _uiState.value.copy(searchQuery = query)
        if (query.isBlank()) {
            _uiState.value = _uiState.value.copy(searchResults = emptyList())
            return
        }
        viewModelScope.launch {
            val result = ServiceTreeRepository.searchServices(query)
            result.fold(
                onSuccess = { results ->
                    _uiState.value = _uiState.value.copy(searchResults = results)
                },
                onFailure = { /* Silently ignore */ }
            )
        }
    }

    fun toggleExpanded(categoryId: String) {
        val current = _uiState.value.expandedIds.toMutableSet()
        if (current.contains(categoryId)) {
            current.remove(categoryId)
        } else {
            current.add(categoryId)
        }
        _uiState.value = _uiState.value.copy(expandedIds = current)
    }

    /** Toggle selection of a service (child) item */
    fun toggleServiceSelection(serviceId: String, serviceName: String, categoryId: String) {
        val current = _uiState.value.selectedServices.toMutableList()
        val existing = current.indexOfFirst { it.id == serviceId || it.name == serviceName }
        if (existing >= 0) {
            current.removeAt(existing)
        } else {
            current.add(ServiceSelection(id = serviceId, name = serviceName, categoryId = categoryId))
        }
        _uiState.value = _uiState.value.copy(selectedServices = current)
    }

    /** Check if a service is currently selected */
    fun isServiceSelected(serviceId: String): Boolean {
        return _uiState.value.selectedServices.any { it.id == serviceId }
    }

    fun clearSelection() {
        _uiState.value = _uiState.value.copy(selectedServices = emptyList())
    }

    /** Get the primary category ID from the first selected service */
    val primaryCategoryId: String?
        get() = _uiState.value.selectedServices.firstOrNull()?.categoryId

    /** Get comma-separated service names for context display */
    val contextString: String?
        get() = _uiState.value.selectedServices
            .takeIf { it.isNotEmpty() }
            ?.joinToString(", ") { it.name }

    /** Get list of selected service names */
    val selectedServiceNames: List<String>
        get() = _uiState.value.selectedServices.map { it.name }
}
