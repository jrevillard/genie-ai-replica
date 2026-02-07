package com.genieai.mobile.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Language
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.genieai.mobile.R

data class LanguageOption(
    val code: String,
    val name: String
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LanguageSelector(
    selectedLanguage: String,
    onLanguageSelected: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val languages = remember {
        listOf(
            LanguageOption("en", "English"),
            LanguageOption("ar", "العربية"),
            LanguageOption("de", "Deutsch"),
            LanguageOption("es", "Español"),
            LanguageOption("fr", "Français"),
            LanguageOption("id", "Bahasa Indonesia"),
            LanguageOption("pt", "Português"),
            LanguageOption("ru", "Русский"),
            LanguageOption("sw", "Kiswahili"),
            LanguageOption("th", "ไทย"),
            LanguageOption("zh", "中文")
        )
    }

    var expanded by remember { mutableStateOf(false) }
    val selectedOption = languages.find { it.code == selectedLanguage } ?: languages.first()

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
        modifier = modifier
    ) {
        OutlinedTextField(
            value = selectedOption.name,
            onValueChange = { },
            readOnly = true,
            label = { Text(stringResource(R.string.settings_display_language)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            leadingIcon = { Icon(Icons.Default.Language, contentDescription = null) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor()
        )

        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false }
        ) {
            languages.forEach { language ->
                DropdownMenuItem(
                    text = { Text(language.name) },
                    onClick = {
                        onLanguageSelected(language.code)
                        expanded = false
                    }
                )
            }
        }
    }
}
