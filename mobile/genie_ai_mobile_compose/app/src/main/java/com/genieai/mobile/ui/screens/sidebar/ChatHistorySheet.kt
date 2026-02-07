package com.genieai.mobile.ui.screens.sidebar

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.genieai.mobile.R
import com.genieai.mobile.data.model.Conversation
import com.genieai.mobile.ui.theme.*
import com.genieai.mobile.util.FlexibleDateParser
import com.genieai.mobile.viewmodel.ChatHistoryTab
import com.genieai.mobile.viewmodel.ChatHistoryViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatHistorySheet(
    chatHistoryViewModel: ChatHistoryViewModel,
    onDismiss: () -> Unit,
    onConversationSelected: (Conversation) -> Unit
) {
    val uiState by chatHistoryViewModel.uiState.collectAsState()
    val filteredConversations = chatHistoryViewModel.getFilteredConversations()
    var searchQuery by remember { mutableStateOf("") }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = RoundedCornerShape(topStart = Radii.sheet, topEnd = Radii.sheet)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.85f)
        ) {
            // Header
            Text(
                text = stringResource(R.string.sidebar_chat_history),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = Spacing.lg, vertical = Spacing.sm)
            )

            // Search
            OutlinedTextField(
                value = searchQuery,
                onValueChange = {
                    searchQuery = it
                    chatHistoryViewModel.setSearchQuery(it)
                },
                placeholder = { Text(stringResource(R.string.sidebar_search_conversations)) },
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
                            chatHistoryViewModel.setSearchQuery("")
                        }) {
                            Icon(Icons.Default.Close, contentDescription = null)
                        }
                    }
                }
            )

            Spacer(modifier = Modifier.height(Spacing.sm))

            // Tabs
            ScrollableTabRow(
                selectedTabIndex = ChatHistoryTab.entries.indexOf(uiState.selectedTab),
                edgePadding = Spacing.lg,
                divider = {}
            ) {
                ChatHistoryTab.entries.forEach { tab ->
                    Tab(
                        selected = uiState.selectedTab == tab,
                        onClick = { chatHistoryViewModel.setTab(tab) },
                        text = {
                            Text(
                                when (tab) {
                                    ChatHistoryTab.ALL -> stringResource(R.string.sidebar_tab_all)
                                    ChatHistoryTab.FOLDERS -> stringResource(R.string.sidebar_tab_folders)
                                    ChatHistoryTab.STARRED -> stringResource(R.string.sidebar_tab_starred)
                                    ChatHistoryTab.ARCHIVED -> stringResource(R.string.sidebar_tab_archived)
                                }
                            )
                        }
                    )
                }
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
            } else if (filteredConversations.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = stringResource(R.string.sidebar_no_chats),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(horizontal = Spacing.lg, vertical = Spacing.sm)
                ) {
                    items(filteredConversations, key = { it.id }) { conversation ->
                        ConversationItem(
                            conversation = conversation,
                            onClick = { onConversationSelected(conversation) },
                            onStar = { chatHistoryViewModel.toggleStar(conversation.id) },
                            onArchive = { chatHistoryViewModel.toggleArchive(conversation.id) },
                            onDelete = { chatHistoryViewModel.deleteConversation(conversation.id) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ConversationItem(
    conversation: Conversation,
    onClick: () -> Unit,
    onStar: () -> Unit,
    onArchive: () -> Unit,
    onDelete: () -> Unit
) {
    var showMenu by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = Spacing.xxs)
            .clickable { onClick() },
        shape = RoundedCornerShape(Radii.md),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(Spacing.md),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (conversation.isStarred) {
                        Icon(
                            Icons.Default.Star,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = WarningAmber
                        )
                        Spacer(modifier = Modifier.width(Spacing.xs))
                    }
                    Text(
                        text = conversation.title,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Spacer(modifier = Modifier.height(Spacing.xxs))
                Row {
                    Text(
                        text = "${conversation.messageCount} ${stringResource(R.string.sidebar_messages)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    conversation.updatedAt?.let { date ->
                        Text(
                            text = " · ${FlexibleDateParser.formatRelative(date)}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            Box {
                IconButton(onClick = { showMenu = true }) {
                    Icon(Icons.Default.MoreVert, contentDescription = null)
                }
                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false }
                ) {
                    DropdownMenuItem(
                        text = {
                            Text(
                                if (conversation.isStarred) stringResource(R.string.sidebar_unstar)
                                else stringResource(R.string.sidebar_star)
                            )
                        },
                        onClick = { showMenu = false; onStar() },
                        leadingIcon = {
                            Icon(
                                if (conversation.isStarred) Icons.Default.Star else Icons.Default.StarBorder,
                                contentDescription = null
                            )
                        }
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.sidebar_archive)) },
                        onClick = { showMenu = false; onArchive() },
                        leadingIcon = {
                            Icon(Icons.Default.Archive, contentDescription = null)
                        }
                    )
                    DropdownMenuItem(
                        text = {
                            Text(
                                stringResource(R.string.sidebar_delete_chat),
                                color = ErrorRed
                            )
                        },
                        onClick = { showMenu = false; onDelete() },
                        leadingIcon = {
                            Icon(
                                Icons.Default.Delete,
                                contentDescription = null,
                                tint = ErrorRed
                            )
                        }
                    )
                }
            }
        }
    }
}
