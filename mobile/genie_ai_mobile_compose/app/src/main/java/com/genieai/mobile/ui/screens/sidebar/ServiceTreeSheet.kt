package com.genieai.mobile.ui.screens.sidebar

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.genieai.mobile.R
import com.genieai.mobile.data.model.ServiceCategory
import com.genieai.mobile.ui.theme.*
import com.genieai.mobile.viewmodel.ServiceTreeViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServiceTreeSheet(
    serviceTreeViewModel: ServiceTreeViewModel,
    onDismiss: () -> Unit,
    onSelectionApplied: (categoryId: String?, contextLabels: List<String>) -> Unit
) {
    val uiState by serviceTreeViewModel.uiState.collectAsState()
    var searchQuery by remember { mutableStateOf("") }
    val selectionCount = uiState.selectedServices.size

    ModalBottomSheet(
        onDismissRequest = {
            // Apply selection when sheet is dismissed
            applySelection(serviceTreeViewModel, onSelectionApplied)
            onDismiss()
        },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = RoundedCornerShape(topStart = Radii.sheet, topEnd = Radii.sheet)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.85f)
        ) {
            // Header with selection count
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.lg, vertical = Spacing.sm),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = stringResource(R.string.sidebar_knowledge_areas),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                if (selectionCount > 0) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.sm)
                    ) {
                        TextButton(onClick = { serviceTreeViewModel.clearSelection() }) {
                            Text(stringResource(R.string.common_clear))
                        }
                        FilledTonalButton(
                            onClick = {
                                applySelection(serviceTreeViewModel, onSelectionApplied)
                                onDismiss()
                            }
                        ) {
                            Text(stringResource(R.string.common_done))
                            Spacer(Modifier.width(Spacing.xs))
                            Badge { Text("$selectionCount") }
                        }
                    }
                }
            }

            // Search
            OutlinedTextField(
                value = searchQuery,
                onValueChange = {
                    searchQuery = it
                    serviceTreeViewModel.search(it)
                },
                placeholder = { Text(stringResource(R.string.sidebar_search_placeholder)) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.lg),
                shape = RoundedCornerShape(Radii.input),
                singleLine = true,
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                trailingIcon = {
                    if (searchQuery.isNotEmpty()) {
                        IconButton(onClick = {
                            searchQuery = ""
                            serviceTreeViewModel.search("")
                        }) {
                            Icon(Icons.Default.Close, contentDescription = null)
                        }
                    }
                }
            )

            Spacer(modifier = Modifier.height(Spacing.sm))

            // Selection summary
            if (selectionCount > 0) {
                val contextString = serviceTreeViewModel.contextString ?: ""
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = Spacing.lg, vertical = Spacing.xs),
                    color = MaterialTheme.colorScheme.primaryContainer,
                    shape = RoundedCornerShape(Radii.sm)
                ) {
                    Text(
                        text = "${stringResource(R.string.chatbot_context_prefix)} $contextString",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.sm)
                    )
                }
                Spacer(modifier = Modifier.height(Spacing.xs))
            }

            // Content
            if (uiState.isLoading) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else if (uiState.error != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = uiState.error ?: "Failed to load",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error
                        )
                        Spacer(modifier = Modifier.height(Spacing.md))
                        OutlinedButton(onClick = { serviceTreeViewModel.loadCategories() }) {
                            Text(stringResource(R.string.common_retry))
                        }
                    }
                }
            } else {
                val displayCategories = if (searchQuery.isNotBlank()) uiState.searchResults
                    else uiState.categories

                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = Spacing.lg, vertical = Spacing.sm)
                ) {
                    items(displayCategories, key = { it.id }) { category ->
                        CategoryItem(
                            category = category,
                            isExpanded = uiState.expandedIds.contains(category.id),
                            selectedServiceIds = uiState.selectedServices.map { it.id }.toSet(),
                            onToggleExpand = { serviceTreeViewModel.toggleExpanded(category.id) },
                            onToggleService = { serviceId, serviceName ->
                                serviceTreeViewModel.toggleServiceSelection(serviceId, serviceName, category.id)
                            },
                            depth = 0
                        )
                    }
                }
            }
        }
    }
}

private fun applySelection(
    viewModel: ServiceTreeViewModel,
    callback: (categoryId: String?, contextLabels: List<String>) -> Unit
) {
    callback(viewModel.primaryCategoryId, viewModel.selectedServiceNames)
}

@Composable
private fun CategoryItem(
    category: ServiceCategory,
    isExpanded: Boolean,
    selectedServiceIds: Set<String>,
    onToggleExpand: () -> Unit,
    onToggleService: (serviceId: String, serviceName: String) -> Unit,
    depth: Int
) {
    val hasChildren = category.children.isNotEmpty()
    val badgeColor = CategoryPalette.color(category.name)

    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = (depth * 16).dp)
                .clip(RoundedCornerShape(Radii.sm))
                .clickable {
                    if (hasChildren) {
                        onToggleExpand()
                    } else {
                        // Leaf node = service — toggle selection
                        onToggleService(category.id, category.name)
                    }
                }
                .background(
                    if (!hasChildren && selectedServiceIds.contains(category.id))
                        MaterialTheme.colorScheme.primaryContainer
                    else MaterialTheme.colorScheme.surface
                )
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (hasChildren) {
                // Category icon badge
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(badgeColor.copy(alpha = 0.15f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Default.Folder,
                        contentDescription = null,
                        tint = badgeColor,
                        modifier = Modifier.size(18.dp)
                    )
                }
            } else {
                // Service checkmark
                val isSelected = selectedServiceIds.contains(category.id)
                Icon(
                    if (isSelected) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked,
                    contentDescription = null,
                    tint = if (isSelected) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                    modifier = Modifier.size(24.dp)
                )
                Spacer(modifier = Modifier.width(Spacing.xs))
            }

            Spacer(modifier = Modifier.width(Spacing.md))

            Text(
                text = category.name,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (hasChildren) FontWeight.Medium else FontWeight.Normal,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )

            if (hasChildren) {
                Icon(
                    if (isExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        // Children
        AnimatedVisibility(
            visible = isExpanded && hasChildren,
            enter = expandVertically(),
            exit = shrinkVertically()
        ) {
            Column {
                category.children.forEach { child ->
                    CategoryItem(
                        category = child,
                        isExpanded = false,
                        selectedServiceIds = selectedServiceIds,
                        onToggleExpand = { },
                        onToggleService = { serviceId, serviceName ->
                            onToggleService(serviceId, serviceName)
                        },
                        depth = depth + 1
                    )
                }
            }
        }
    }
}
