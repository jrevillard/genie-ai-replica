package com.genieai.mobile.ui.theme

import androidx.compose.ui.graphics.Color

// Brand colors from genie-ai-config.json
val PrimaryBlue = Color(0xFF4682B4)       // Friendly Blue / Steel Blue
val SecondaryTeal = Color(0xFF5F9EA0)     // Soft Teal / Cadet Blue
val BrandBackground = Color(0xFFD3E0EA)   // Light Blue background
val BrandText = Color(0xFF1C2526)         // Dark charcoal text

// Navbar gradient
val NavbarGradientStart = PrimaryBlue
val NavbarGradientEnd = SecondaryTeal
val NavbarText = Color(0xFFF0F8FF)        // Alice Blue

// Glass design system — light mode
val GlassSurface = Color(0xFFFAFCFE)
val GlassSurfaceVariant = Color(0xFFF0F4F8)
val GlassBorder = Color(0x33FFFFFF)
val GlassBorderSubtle = Color(0x1A4682B4)
val GlassOverlay = Color(0x0D4682B4)

// Glass design system — dark mode
val GlassSurfaceDark = Color(0xFF1A1D21)
val GlassSurfaceVariantDark = Color(0xFF242830)
val GlassBorderDark = Color(0x33FFFFFF)
val GlassBorderSubtleDark = Color(0x1A7ABADD)
val GlassOverlayDark = Color(0x0D7ABADD)

// Semantic colors
val SuccessGreen = Color(0xFF4CAF50)
val WarningAmber = Color(0xFFFFC107)
val ErrorRed = Color(0xFFE53935)
val InfoBlue = Color(0xFF2196F3)

// Chat bubble colors
val UserBubbleBackground = PrimaryBlue.copy(alpha = 0.12f)
val UserBubbleBorder = PrimaryBlue.copy(alpha = 0.25f)
val BotBubbleBackground = Color(0xFFF0F4F8)  // light thin-material equivalent
val BotBubbleBorder = GlassBorderSubtle

// Dark mode chat bubbles
val UserBubbleBackgroundDark = PrimaryBlue.copy(alpha = 0.15f)
val UserBubbleBorderDark = PrimaryBlue.copy(alpha = 0.30f)
val BotBubbleBackgroundDark = Color(0xFF2A2D35)
val BotBubbleBorderDark = GlassBorderSubtleDark

// Light theme full palette
val LightBackground = Color(0xFFF8FAFC)
val LightSurface = Color(0xFFFFFFFF)
val LightSurfaceVariant = Color(0xFFF0F4F8)
val LightOnBackground = Color(0xFF1A1D21)
val LightOnSurface = Color(0xFF1A1D21)
val LightOnSurfaceVariant = Color(0xFF5A6370)
val LightOutline = Color(0xFFDDE3EA)
val LightOutlineVariant = Color(0xFFE8ECF0)

// Dark theme full palette
val DarkBackground = Color(0xFF121417)
val DarkSurface = Color(0xFF1A1D21)
val DarkSurfaceVariant = Color(0xFF242830)
val DarkOnBackground = Color(0xFFE8ECF0)
val DarkOnSurface = Color(0xFFE8ECF0)
val DarkOnSurfaceVariant = Color(0xFF9AA3B0)
val DarkOutline = Color(0xFF3A3F48)
val DarkOutlineVariant = Color(0xFF2E3440)
