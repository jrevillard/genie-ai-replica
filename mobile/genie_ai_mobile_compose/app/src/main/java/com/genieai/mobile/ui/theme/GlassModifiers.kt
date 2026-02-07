package com.genieai.mobile.ui.theme

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * Glass card modifier — translucent surface + subtle border + soft shadow.
 * Android equivalent of SwiftUI's `.thinMaterial`.
 */
fun Modifier.glassCard(
    isDark: Boolean = false,
    cornerRadius: Dp = Radii.card,
    elevation: Dp = 2.dp
): Modifier {
    val shape = RoundedCornerShape(cornerRadius)
    val surface = if (isDark) GlassSurfaceDark else GlassSurface
    val borderColor = if (isDark) GlassBorderSubtleDark else GlassBorderSubtle

    return this
        .shadow(elevation, shape, spotColor = Color.Black.copy(alpha = 0.08f))
        .clip(shape)
        .background(surface.copy(alpha = 0.92f))
        .border(0.5.dp, borderColor, shape)
}

/**
 * Elevated glass card — slightly more opaque with stronger shadow.
 */
fun Modifier.glassCardElevated(
    isDark: Boolean = false,
    cornerRadius: Dp = Radii.card,
    elevation: Dp = 6.dp
): Modifier {
    val shape = RoundedCornerShape(cornerRadius)
    val surface = if (isDark) GlassSurfaceDark else GlassSurface
    val borderColor = if (isDark) GlassBorderSubtleDark else GlassBorderSubtle

    return this
        .shadow(elevation, shape, spotColor = Color.Black.copy(alpha = 0.12f))
        .clip(shape)
        .background(surface.copy(alpha = 0.96f))
        .border(0.5.dp, borderColor, shape)
}

/**
 * Pressable glass button style with spring animation and haptic feedback.
 */
@Composable
fun GlassPressButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    hapticsEnabled: Boolean = true,
    animationsEnabled: Boolean = true,
    content: @Composable () -> Unit
) {
    val haptic = LocalHapticFeedback.current
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()

    val scale by animateFloatAsState(
        targetValue = if (isPressed && animationsEnabled) 0.96f else 1f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessLow
        ),
        label = "pressScale"
    )

    Box(
        modifier = modifier
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                enabled = enabled
            ) {
                if (hapticsEnabled) {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                }
                onClick()
            },
        contentAlignment = Alignment.Center
    ) {
        content()
    }
}

/**
 * Bouncing dots loading indicator (3 dots).
 */
@Composable
fun BouncingDotsIndicator(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    dotSize: Dp = 8.dp,
    dotSpacing: Dp = 4.dp,
    animationsEnabled: Boolean = true
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(dotSpacing),
        verticalAlignment = Alignment.CenterVertically
    ) {
        repeat(3) { index ->
            val delayMs = index * 200L
            var animating by remember { mutableStateOf(false) }

            LaunchedEffect(Unit) {
                while (true) {
                    delay(delayMs)
                    animating = true
                    delay(600)
                    animating = false
                    delay(600 - delayMs)
                }
            }

            val offsetY by animateFloatAsState(
                targetValue = if (animating && animationsEnabled) -6f else 0f,
                animationSpec = spring(
                    dampingRatio = Spring.DampingRatioMediumBouncy,
                    stiffness = Spring.StiffnessMedium
                ),
                label = "dot$index"
            )

            Box(
                modifier = Modifier
                    .size(dotSize)
                    .graphicsLayer { translationY = offsetY }
                    .clip(RoundedCornerShape(50))
                    .background(color)
            )
        }
    }
}

/**
 * Gradient brush for brand accent — used on sparkles, message bubbles, send button.
 */
val BrandGradient: Brush
    @Composable get() = Brush.horizontalGradient(
        colors = listOf(PrimaryBlue, SecondaryTeal)
    )

/**
 * Haptic-enabled clickable modifier.
 */
@Composable
fun Modifier.hapticClickable(
    hapticsEnabled: Boolean = true,
    onClick: () -> Unit
): Modifier {
    val haptic = LocalHapticFeedback.current
    return this.clickable {
        if (hapticsEnabled) {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        }
        onClick()
    }
}
