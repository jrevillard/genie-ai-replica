package com.genieai.mobile.ui.screens.sidebar

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.genieai.mobile.R
import com.genieai.mobile.data.model.RelatedDocument
import com.genieai.mobile.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InfoResourcesSheet(
    relatedDocuments: List<RelatedDocument>,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    var faqContent by remember { mutableStateOf<List<FaqItem>>(emptyList()) }

    // Load FAQ
    LaunchedEffect(Unit) {
        try {
            val rawId = context.resources.getIdentifier("faq", "raw", context.packageName)
            if (rawId != 0) {
                val text = context.resources.openRawResource(rawId).bufferedReader().readText()
                faqContent = parseFaq(text)
            }
        } catch (_: Exception) { }
    }

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
                text = stringResource(R.string.sidebar_title),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = Spacing.lg, vertical = Spacing.sm)
            )

            LazyColumn(
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(horizontal = Spacing.lg, vertical = Spacing.sm)
            ) {
                // Related Documents section
                item {
                    Text(
                        text = stringResource(R.string.sidebar_related_docs),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(vertical = Spacing.sm)
                    )
                }

                if (relatedDocuments.isEmpty()) {
                    item {
                        Text(
                            text = stringResource(R.string.sidebar_no_documents),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = Spacing.sm)
                        )
                    }
                } else {
                    items(relatedDocuments) { doc ->
                        RelatedDocumentItem(doc)
                    }
                }

                // FAQ section
                item {
                    Spacer(modifier = Modifier.height(Spacing.xl))
                    Text(
                        text = stringResource(R.string.sidebar_faq),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(vertical = Spacing.sm)
                    )
                }

                items(faqContent) { faq ->
                    FaqAccordionItem(faq)
                }
            }
        }
    }
}

@Composable
private fun RelatedDocumentItem(doc: RelatedDocument) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = Spacing.xxs),
        shape = RoundedCornerShape(Radii.sm),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Row(
            modifier = Modifier.padding(Spacing.md),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Description,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(Spacing.md))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = doc.name,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                if (doc.fileName.isNotBlank()) {
                    Text(
                        text = doc.fileName,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            // Confidence badge
            if (doc.confidence > 0) {
                Text(
                    text = "${(doc.confidence * 100).toInt()}%",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }
    }
}

@Composable
private fun FaqAccordionItem(faq: FaqItem) {
    var expanded by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = Spacing.xxs),
        shape = RoundedCornerShape(Radii.sm),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(
            modifier = Modifier.clickable { expanded = !expanded }
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(Spacing.md),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = faq.question,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.weight(1f)
                )
                Icon(
                    if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp)
                )
            }
            AnimatedVisibility(
                visible = expanded,
                enter = expandVertically(),
                exit = shrinkVertically()
            ) {
                Text(
                    text = faq.answer,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(
                        start = Spacing.md,
                        end = Spacing.md,
                        bottom = Spacing.md
                    )
                )
            }
        }
    }
}

private data class FaqItem(val question: String, val answer: String)

private fun parseFaq(markdown: String): List<FaqItem> {
    val items = mutableListOf<FaqItem>()
    var currentQuestion: String? = null
    val currentAnswer = StringBuilder()

    for (line in markdown.lines()) {
        if (line.startsWith("## ")) {
            // Save previous item
            currentQuestion?.let { q ->
                items.add(FaqItem(q.removePrefix("**").removeSuffix("**"), currentAnswer.toString().trim()))
            }
            currentQuestion = line.removePrefix("## ").trim()
            currentAnswer.clear()
        } else if (currentQuestion != null) {
            currentAnswer.appendLine(line)
        }
    }
    // Save last item
    currentQuestion?.let { q ->
        items.add(FaqItem(q.removePrefix("**").removeSuffix("**"), currentAnswer.toString().trim()))
    }

    return items
}
