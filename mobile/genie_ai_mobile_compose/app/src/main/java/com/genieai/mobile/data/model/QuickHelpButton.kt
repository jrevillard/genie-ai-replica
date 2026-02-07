package com.genieai.mobile.data.model

import androidx.compose.ui.graphics.Color

data class QuickHelpButton(
    val id: String = "",
    val category: String? = null,
    val labelText: String = "",
    val labelColor: Color = Color.Unspecified,
    val iconPath: String = "",
    val iconColor: Color = Color.Unspecified,
    val gradientStart: Color = Color.Unspecified,
    val gradientEnd: Color = Color.Unspecified,
    val darkLabelColor: Color = Color.Unspecified,
    val darkIconColor: Color = Color.Unspecified,
    val darkGradientStart: Color = Color.Unspecified,
    val darkGradientEnd: Color = Color.Unspecified,
    val visibleText: String = "",
    val hiddenPrompt: String = ""
)
