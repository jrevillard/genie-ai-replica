package com.genieai.mobile.ui.screens.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.genieai.mobile.R
import com.genieai.mobile.ui.components.ConfirmDialog
import com.genieai.mobile.ui.theme.*
import com.genieai.mobile.viewmodel.SettingsViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onNavigateBack: () -> Unit,
    onLogout: () -> Unit,
    settingsViewModel: SettingsViewModel = viewModel()
) {
    val uiState by settingsViewModel.uiState.collectAsState()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    var showDeleteDialog by remember { mutableStateOf(false) }
    var showResetDialog by remember { mutableStateOf(false) }
    var showEmailDialog by remember { mutableStateOf(false) }

    LaunchedEffect(uiState.successMessage) {
        uiState.successMessage?.let {
            snackbarHostState.showSnackbar(it)
            settingsViewModel.clearMessages()
        }
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            settingsViewModel.clearMessages()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg)
        ) {
            // ── Display Section ───────────────────────────
            SettingsSection(title = stringResource(R.string.settings_display)) {
                // Theme
                Text(
                    text = stringResource(R.string.settings_theme),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Medium
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm)
                ) {
                    listOf("light" to R.string.settings_theme_light, "dark" to R.string.settings_theme_dark, "system" to R.string.settings_theme_system).forEach { (mode, labelRes) ->
                        FilterChip(
                            selected = uiState.themeMode == mode,
                            onClick = { settingsViewModel.setThemeMode(context, mode) },
                            label = { Text(stringResource(labelRes)) }
                        )
                    }
                }

                Spacer(modifier = Modifier.height(Spacing.sm))

                // Font size
                Text(
                    text = "${stringResource(R.string.settings_font_size)}: ${(uiState.fontSize * 100).toInt()}%",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Medium
                )
                Slider(
                    value = uiState.fontSize,
                    onValueChange = { settingsViewModel.setFontSize(context, it) },
                    valueRange = 0.8f..1.4f,
                    steps = 5
                )

                // Animations toggle
                SettingsToggle(
                    label = stringResource(R.string.settings_animations),
                    checked = uiState.animationsEnabled,
                    onCheckedChange = { settingsViewModel.setAnimationsEnabled(context, it) }
                )

                // Haptics toggle
                SettingsToggle(
                    label = stringResource(R.string.settings_haptics),
                    checked = uiState.hapticsEnabled,
                    onCheckedChange = { settingsViewModel.setHapticsEnabled(context, it) }
                )
            }

            // ── Notifications Section ─────────────────────
            SettingsSection(title = stringResource(R.string.settings_notifications)) {
                SettingsToggle(
                    label = stringResource(R.string.settings_email_updates),
                    checked = uiState.emailNotifications,
                    onCheckedChange = { settingsViewModel.setEmailNotifications(context, it) }
                )
                SettingsToggle(
                    label = stringResource(R.string.settings_sound_notifications),
                    checked = uiState.soundNotifications,
                    onCheckedChange = { settingsViewModel.setSoundNotifications(context, it) }
                )
            }

            // ── Account Management Section ────────────────
            SettingsSection(title = stringResource(R.string.settings_account_management)) {
                // Email
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = stringResource(R.string.settings_email_address),
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            text = uiState.email.ifBlank { "—" },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    TextButton(onClick = { showEmailDialog = true }) {
                        Text(stringResource(R.string.settings_edit))
                    }
                }

                HorizontalDivider()

                // Password
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = stringResource(R.string.settings_password),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Medium
                    )
                    TextButton(onClick = { settingsViewModel.initiatePasswordReset() }) {
                        Text(stringResource(R.string.settings_change_password))
                    }
                }

                HorizontalDivider()

                // Reset user data
                OutlinedButton(
                    onClick = { showResetDialog = true },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = WarningAmber
                    )
                ) {
                    Icon(Icons.Default.RestartAlt, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(Spacing.sm))
                    Text(stringResource(R.string.settings_reset_user_data))
                }

                Text(
                    text = stringResource(R.string.settings_reset_user_data_desc),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // Delete account
                OutlinedButton(
                    onClick = { showDeleteDialog = true },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = ErrorRed
                    )
                ) {
                    Icon(Icons.Default.DeleteForever, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(Spacing.sm))
                    Text(stringResource(R.string.settings_delete_account))
                }

                Text(
                    text = stringResource(R.string.settings_delete_account_desc),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(modifier = Modifier.height(Spacing.xxl))
        }
    }

    // Dialogs
    if (showResetDialog) {
        ConfirmDialog(
            title = stringResource(R.string.settings_reset_user_data),
            message = stringResource(R.string.settings_confirm_reset_user_data),
            confirmText = stringResource(R.string.settings_reset),
            onConfirm = {
                settingsViewModel.resetUserData()
                showResetDialog = false
            },
            onDismiss = { showResetDialog = false }
        )
    }

    if (showDeleteDialog) {
        DeleteAccountDialog(
            onConfirm = { password, reason ->
                settingsViewModel.deleteAccount(password, reason)
                showDeleteDialog = false
                onLogout()
            },
            onDismiss = { showDeleteDialog = false }
        )
    }

    if (showEmailDialog) {
        EmailChangeDialog(
            currentEmail = uiState.email,
            onConfirm = { newEmail, password ->
                settingsViewModel.updateEmail(newEmail, password)
                showEmailDialog = false
            },
            onDismiss = { showEmailDialog = false }
        )
    }
}

@Composable
private fun SettingsSection(
    title: String,
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radii.card),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(
            modifier = Modifier.padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.md)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            content()
        }
    }
}

@Composable
private fun SettingsToggle(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium
        )
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange
        )
    }
}

@Composable
private fun DeleteAccountDialog(
    onConfirm: (String, String?) -> Unit,
    onDismiss: () -> Unit
) {
    var password by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(Radii.dialog),
        title = { Text(stringResource(R.string.settings_confirm_account_deletion), fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Text(
                    stringResource(R.string.settings_account_deletion_warning),
                    style = MaterialTheme.typography.bodySmall,
                    color = ErrorRed
                )
                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text(stringResource(R.string.settings_deletion_reason)) },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(Radii.input)
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text(stringResource(R.string.settings_password)) },
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(Radii.input)
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(password, reason.ifBlank { null }) },
                enabled = password.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = ErrorRed)
            ) {
                Text(stringResource(R.string.settings_delete_account))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.common_cancel))
            }
        }
    )
}

@Composable
private fun EmailChangeDialog(
    currentEmail: String,
    onConfirm: (String, String) -> Unit,
    onDismiss: () -> Unit
) {
    var newEmail by remember { mutableStateOf(currentEmail) }
    var password by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(Radii.dialog),
        title = { Text(stringResource(R.string.settings_confirm_email_change)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                OutlinedTextField(
                    value = newEmail,
                    onValueChange = { newEmail = it },
                    label = { Text(stringResource(R.string.settings_email_address)) },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(Radii.input)
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text(stringResource(R.string.settings_password)) },
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(Radii.input)
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(newEmail, password) },
                enabled = newEmail.isNotBlank() && password.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = PrimaryBlue)
            ) {
                Text(stringResource(R.string.common_confirm))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.common_cancel))
            }
        }
    )
}
