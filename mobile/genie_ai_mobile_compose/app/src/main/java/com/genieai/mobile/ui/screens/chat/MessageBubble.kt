package com.genieai.mobile.ui.screens.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.genieai.mobile.data.model.Message
import com.genieai.mobile.data.model.MessageRole
import com.genieai.mobile.ui.theme.*

@Composable
fun MessageBubble(
    message: Message,
    isDark: Boolean = false,
    onFeedbackClick: ((String) -> Unit)? = null
) {
    val isUser = message.role == MessageRole.USER
    val alignment = if (isUser) Arrangement.End else Arrangement.Start

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(
                start = if (isUser) Spacing.xxxl else Spacing.sm,
                end = if (isUser) Spacing.sm else Spacing.xxxl,
                top = Spacing.xs,
                bottom = Spacing.xs
            ),
        horizontalArrangement = alignment
    ) {
        Column(
            modifier = Modifier
                .clip(
                    RoundedCornerShape(
                        topStart = Radii.lg,
                        topEnd = Radii.lg,
                        bottomStart = if (isUser) Radii.lg else Radii.xs,
                        bottomEnd = if (isUser) Radii.xs else Radii.lg
                    )
                )
                .background(
                    if (isUser) {
                        if (isDark) UserBubbleBackgroundDark else UserBubbleBackground
                    } else {
                        if (isDark) BotBubbleBackgroundDark else BotBubbleBackground
                    }
                )
                .border(
                    width = 0.5.dp,
                    color = if (isUser) {
                        if (isDark) UserBubbleBorderDark else UserBubbleBorder
                    } else {
                        if (isDark) BotBubbleBorderDark else BotBubbleBorder
                    },
                    shape = RoundedCornerShape(
                        topStart = Radii.lg,
                        topEnd = Radii.lg,
                        bottomStart = if (isUser) Radii.lg else Radii.xs,
                        bottomEnd = if (isUser) Radii.xs else Radii.lg
                    )
                )
                .padding(horizontal = Spacing.md, vertical = Spacing.sm)
                .widthIn(max = 320.dp)
        ) {
            if (!isUser) {
                Text(
                    text = "Genie AI",
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(bottom = Spacing.xxs)
                )
            }

            Text(
                text = message.content,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface
            )

            // Feedback buttons for assistant messages
            if (!isUser && message.id.isNotBlank() && onFeedbackClick != null) {
                Spacer(modifier = Modifier.height(Spacing.xs))
                Row(
                    horizontalArrangement = Arrangement.End,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    IconButton(
                        onClick = { onFeedbackClick(message.id) },
                        modifier = Modifier.size(28.dp)
                    ) {
                        Icon(
                            Icons.Default.ThumbUp,
                            contentDescription = "Helpful",
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                        )
                    }
                    IconButton(
                        onClick = { onFeedbackClick(message.id) },
                        modifier = Modifier.size(28.dp)
                    ) {
                        Icon(
                            Icons.Default.ThumbDown,
                            contentDescription = "Not helpful",
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                        )
                    }
                }
            }
        }
    }
}
