package com.genieai.mobile.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * 12 candy pastel colors matching SwiftUI's CategoryPalette for service icon badges.
 * Deterministic: same category name always gets the same color.
 */
object CategoryPalette {

    private val colors = listOf(
        Color(0xFF80CBC4), // teal
        Color(0xFFA5D6A7), // sage
        Color(0xFFEF9A9A), // coral
        Color(0xFFCE93D8), // violet
        Color(0xFF90CAF9), // sky
        Color(0xFFFFE082), // amber
        Color(0xFFF48FB1), // rose
        Color(0xFF9FA8DA), // indigo
        Color(0xFFC5E1A5), // olive
        Color(0xFFBCAAA4), // brown
        Color(0xFFFFCC80), // orange
        Color(0xFF80DEEA), // seafoam
    )

    fun color(name: String): Color {
        val hash = name.hashCode().let { if (it < 0) -it else it }
        return colors[hash % colors.size]
    }

    fun colorAt(index: Int): Color {
        return colors[index % colors.size]
    }
}
