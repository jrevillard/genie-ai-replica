package com.genieai.mobile.ui.screens.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.genieai.mobile.R
import com.genieai.mobile.ui.theme.*

@Composable
fun FeedbackDialog(
    queryId: String,
    onSubmit: (Int, String?) -> Unit,
    onDismiss: () -> Unit
) {
    var rating by remember { mutableIntStateOf(0) }
    var comment by remember { mutableStateOf("") }
    var isSubmitting by remember { mutableStateOf(false) }

    val ratingLabels = listOf(
        stringResource(R.string.feedback_rating_1),
        stringResource(R.string.feedback_rating_2),
        stringResource(R.string.feedback_rating_3),
        stringResource(R.string.feedback_rating_4),
        stringResource(R.string.feedback_rating_5)
    )

    AlertDialog(
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(Radii.dialog),
        title = {
            Text(
                text = stringResource(R.string.feedback_title),
                fontWeight = FontWeight.SemiBold
            )
        },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(Spacing.md)
            ) {
                Text(
                    text = stringResource(R.string.feedback_note),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // Star rating
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    for (i in 1..5) {
                        IconButton(
                            onClick = { rating = i },
                            modifier = Modifier.size(40.dp)
                        ) {
                            Icon(
                                if (i <= rating) Icons.Default.Star else Icons.Default.StarBorder,
                                contentDescription = null,
                                tint = if (i <= rating) WarningAmber else MaterialTheme.colorScheme.outlineVariant,
                                modifier = Modifier.size(32.dp)
                            )
                        }
                    }
                }

                // Rating label
                if (rating > 0) {
                    Text(
                        text = ratingLabels.getOrElse(rating - 1) { "" },
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.align(Alignment.CenterHorizontally)
                    )
                }

                // Comment
                OutlinedTextField(
                    value = comment,
                    onValueChange = { comment = it },
                    placeholder = { Text(stringResource(R.string.feedback_comment_placeholder)) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(100.dp),
                    shape = RoundedCornerShape(Radii.input),
                    maxLines = 4
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    isSubmitting = true
                    onSubmit(rating, comment.ifBlank { null })
                },
                enabled = rating > 0 && !isSubmitting,
                colors = ButtonDefaults.buttonColors(containerColor = PrimaryBlue)
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = NavbarText
                    )
                } else {
                    Text(stringResource(R.string.feedback_submit))
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.common_cancel))
            }
        }
    )
}
