package com.genieai.mobile.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val LightColorScheme = lightColorScheme(
    primary = PrimaryBlue,
    onPrimary = NavbarText,
    primaryContainer = PrimaryBlue.copy(alpha = 0.12f),
    onPrimaryContainer = PrimaryBlue,
    secondary = SecondaryTeal,
    onSecondary = NavbarText,
    secondaryContainer = SecondaryTeal.copy(alpha = 0.12f),
    onSecondaryContainer = SecondaryTeal,
    tertiary = WarningAmber,
    onTertiary = BrandText,
    background = LightBackground,
    onBackground = LightOnBackground,
    surface = LightSurface,
    onSurface = LightOnSurface,
    surfaceVariant = LightSurfaceVariant,
    onSurfaceVariant = LightOnSurfaceVariant,
    outline = LightOutline,
    outlineVariant = LightOutlineVariant,
    error = ErrorRed,
    onError = NavbarText,
    errorContainer = ErrorRed.copy(alpha = 0.12f),
    onErrorContainer = ErrorRed,
)

private val DarkColorScheme = darkColorScheme(
    primary = PrimaryBlue,
    onPrimary = NavbarText,
    primaryContainer = PrimaryBlue.copy(alpha = 0.15f),
    onPrimaryContainer = PrimaryBlue,
    secondary = SecondaryTeal,
    onSecondary = NavbarText,
    secondaryContainer = SecondaryTeal.copy(alpha = 0.15f),
    onSecondaryContainer = SecondaryTeal,
    tertiary = WarningAmber,
    onTertiary = BrandText,
    background = DarkBackground,
    onBackground = DarkOnBackground,
    surface = DarkSurface,
    onSurface = DarkOnSurface,
    surfaceVariant = DarkSurfaceVariant,
    onSurfaceVariant = DarkOnSurfaceVariant,
    outline = DarkOutline,
    outlineVariant = DarkOutlineVariant,
    error = ErrorRed,
    onError = NavbarText,
    errorContainer = ErrorRed.copy(alpha = 0.15f),
    onErrorContainer = ErrorRed,
)

@Composable
fun GenieAITheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = GenieTypography,
        shapes = GenieShapes,
        content = content
    )
}
