package com.genieai.mobile.ui.screens.chat

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.genieai.mobile.R
import com.genieai.mobile.data.model.QuickHelpButton
import com.genieai.mobile.ui.theme.*
import com.genieai.mobile.viewmodel.ChatUiState

@Composable
fun ChatScreen(
    uiState: ChatUiState,
    quickHelpButtons: List<QuickHelpButton>,
    quickHelpColumns: Int,
    isOnline: Boolean,
    onSendMessage: (String) -> Unit,
    onQuickHelpClick: (QuickHelpButton) -> Unit,
    onFeedbackSubmit: (queryId: String, rating: Int, comment: String?) -> Unit,
    onRemoveContext: () -> Unit,
    modifier: Modifier = Modifier
) {
    val isDark = isSystemInDarkTheme()
    val listState = rememberLazyListState()
    var showFeedbackDialog by remember { mutableStateOf<String?>(null) }

    // Auto-scroll to bottom on new messages
    LaunchedEffect(uiState.messages.size) {
        if (uiState.messages.isNotEmpty()) {
            listState.animateScrollToItem(uiState.messages.size - 1)
        }
    }

    Column(modifier = modifier.fillMaxSize()) {
        // Messages list
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(vertical = Spacing.sm)
        ) {
            // Welcome state when no messages
            if (uiState.messages.isEmpty()) {
                item {
                    WelcomeContent(
                        quickHelpButtons = quickHelpButtons,
                        quickHelpColumns = quickHelpColumns,
                        onQuickHelpClick = onQuickHelpClick
                    )
                }
            }

            // Messages
            items(uiState.messages, key = { it.id }) { message ->
                MessageBubble(
                    message = message,
                    isDark = isDark,
                    onFeedbackClick = { queryId ->
                        showFeedbackDialog = queryId
                    }
                )
            }

            // Thinking indicator
            if (uiState.isThinking) {
                item {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = Spacing.sm, top = Spacing.xs),
                        horizontalArrangement = Arrangement.Start
                    ) {
                        Column(
                            modifier = Modifier
                                .padding(horizontal = Spacing.md, vertical = Spacing.sm)
                        ) {
                            Text(
                                text = stringResource(R.string.chatbot_thinking),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Spacer(modifier = Modifier.height(Spacing.xs))
                            BouncingDotsIndicator(
                                color = MaterialTheme.colorScheme.primary,
                                dotSize = 6.dp
                            )
                        }
                    }
                }
            }
        }

        // Chat input bar
        ChatInputBar(
            isEnabled = isOnline && !uiState.isThinking,
            contextLabel = uiState.selectedCategoryName,
            onSend = onSendMessage,
            onRemoveContext = if (uiState.selectedCategoryId != null) onRemoveContext else null
        )
    }

    // Feedback dialog
    showFeedbackDialog?.let { queryId ->
        FeedbackDialog(
            queryId = queryId,
            onSubmit = { rating, comment ->
                onFeedbackSubmit(queryId, rating, comment)
                showFeedbackDialog = null
            },
            onDismiss = { showFeedbackDialog = null }
        )
    }
}

@Composable
private fun WelcomeContent(
    quickHelpButtons: List<QuickHelpButton>,
    quickHelpColumns: Int,
    onQuickHelpClick: (QuickHelpButton) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(Spacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xl)
    ) {
        Spacer(modifier = Modifier.height(Spacing.xxl))

        Text(
            text = stringResource(R.string.chatbot_welcome),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onBackground
        )

        Text(
            text = stringResource(R.string.chatbot_what_can_i_help),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )

        if (quickHelpButtons.isNotEmpty()) {
            QuickHelpGrid(
                buttons = quickHelpButtons,
                columns = quickHelpColumns,
                onButtonClick = onQuickHelpClick
            )
        }
    }
}
