package com.genieai.mobile.data.model

data class ServiceCategory(
    val id: String = "",
    val name: String = "",
    val description: String? = null,
    val parentId: String? = null,
    val icon: String? = null,
    val children: List<ServiceCategory> = emptyList(),
    val isExpanded: Boolean = false,
    val isSelected: Boolean = false
)
