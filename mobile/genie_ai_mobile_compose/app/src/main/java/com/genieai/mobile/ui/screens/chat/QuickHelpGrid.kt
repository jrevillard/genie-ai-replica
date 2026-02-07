package com.genieai.mobile.ui.screens.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.genieai.mobile.data.model.QuickHelpButton
import com.genieai.mobile.ui.theme.*

@Composable
fun QuickHelpGrid(
    buttons: List<QuickHelpButton>,
    columns: Int = 2,
    onButtonClick: (QuickHelpButton) -> Unit,
    modifier: Modifier = Modifier
) {
    val isDark = isSystemInDarkTheme()

    Column(
        modifier = modifier.padding(horizontal = Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm)
    ) {
        val rows = buttons.chunked(columns)
        for (row in rows) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm)
            ) {
                for (button in row) {
                    QuickHelpButtonItem(
                        button = button,
                        isDark = isDark,
                        onClick = { onButtonClick(button) },
                        modifier = Modifier.weight(1f)
                    )
                }
                // Fill remaining space if row is not full
                repeat(columns - row.size) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun QuickHelpButtonItem(
    button: QuickHelpButton,
    isDark: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val gradientStart = if (isDark && button.darkGradientStart != Color.Unspecified)
        button.darkGradientStart else button.gradientStart
    val gradientEnd = if (isDark && button.darkGradientEnd != Color.Unspecified)
        button.darkGradientEnd else button.gradientEnd
    val labelColor = if (isDark && button.darkLabelColor != Color.Unspecified)
        button.darkLabelColor else button.labelColor

    val shape = RoundedCornerShape(Radii.sm)

    GlassPressButton(
        onClick = onClick,
        modifier = modifier
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(38.dp)
                .shadow(2.dp, shape, spotColor = Color.Black.copy(alpha = 0.15f))
                .clip(shape)
                .background(
                    Brush.horizontalGradient(
                        colors = listOf(
                            gradientStart.takeIf { it != Color.Unspecified } ?: PrimaryBlue.copy(alpha = 0.15f),
                            gradientEnd.takeIf { it != Color.Unspecified } ?: SecondaryTeal.copy(alpha = 0.15f)
                        )
                    )
                )
                .border(
                    0.5.dp,
                    Color.White.copy(alpha = if (isDark) 0.08f else 0.3f),
                    shape
                )
                .padding(horizontal = Spacing.sm),
            contentAlignment = Alignment.CenterStart
        ) {
            Text(
                text = button.labelText,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Medium,
                fontSize = 11.sp,
                color = labelColor.takeIf { it != Color.Unspecified }
                    ?: MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
