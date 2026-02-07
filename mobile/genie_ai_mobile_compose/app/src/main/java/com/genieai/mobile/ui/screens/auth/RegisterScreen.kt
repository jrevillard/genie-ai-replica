package com.genieai.mobile.ui.screens.auth

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.genieai.mobile.R
import com.genieai.mobile.ui.theme.*
import com.genieai.mobile.viewmodel.AuthViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RegisterScreen(
    onRegistrationSuccess: (String) -> Unit,
    onNavigateToLogin: () -> Unit,
    authViewModel: AuthViewModel = viewModel()
) {
    val uiState by authViewModel.uiState.collectAsState()
    val focusManager = LocalFocusManager.current

    var username by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var acceptedTerms by remember { mutableStateOf(false) }

    // Password strength
    val passwordStrength = remember(password) {
        calculatePasswordStrength(password)
    }

    // Check availability with debounce
    LaunchedEffect(username) {
        if (username.length >= 3) {
            kotlinx.coroutines.delay(500)
            authViewModel.checkUsernameAvailability(username)
        }
    }

    LaunchedEffect(email) {
        if (email.contains("@") && email.contains(".")) {
            kotlinx.coroutines.delay(500)
            authViewModel.checkEmailAvailability(email)
        }
    }

    // Handle registration success
    LaunchedEffect(uiState.registrationSuccess) {
        if (uiState.registrationSuccess) {
            onRegistrationSuccess(email)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.register_create_account)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateToLogin) {
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
                .padding(horizontal = Spacing.xl)
                .imePadding(),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg)
        ) {
            Spacer(modifier = Modifier.height(Spacing.sm))

            // Username
            OutlinedTextField(
                value = username,
                onValueChange = { username = it },
                label = { Text(stringResource(R.string.register_username)) },
                placeholder = { Text(stringResource(R.string.register_username_placeholder)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(Radii.input),
                trailingIcon = {
                    if (username.length >= 3) {
                        uiState.usernameAvailable?.let { available ->
                            Icon(
                                if (available) Icons.Default.CheckCircle else Icons.Default.Error,
                                contentDescription = null,
                                tint = if (available) SuccessGreen else ErrorRed
                            )
                        }
                    }
                },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) }
                )
            )

            // Email
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text(stringResource(R.string.register_email)) },
                placeholder = { Text(stringResource(R.string.register_email_placeholder)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(Radii.input),
                trailingIcon = {
                    if (email.contains("@")) {
                        uiState.emailAvailable?.let { available ->
                            Icon(
                                if (available) Icons.Default.CheckCircle else Icons.Default.Error,
                                contentDescription = null,
                                tint = if (available) SuccessGreen else ErrorRed
                            )
                        }
                    }
                },
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Next
                ),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) }
                )
            )

            // Password
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text(stringResource(R.string.register_password)) },
                placeholder = { Text(stringResource(R.string.register_password_placeholder)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(Radii.input),
                visualTransformation = if (passwordVisible) VisualTransformation.None
                    else PasswordVisualTransformation(),
                trailingIcon = {
                    IconButton(onClick = { passwordVisible = !passwordVisible }) {
                        Icon(
                            if (passwordVisible) Icons.Default.VisibilityOff
                            else Icons.Default.Visibility,
                            contentDescription = null
                        )
                    }
                },
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Next
                ),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) }
                )
            )

            // Password strength indicator
            AnimatedVisibility(visible = password.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    LinearProgressIndicator(
                        progress = { passwordStrength.score / 5f },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(4.dp)
                            .clip(RoundedCornerShape(2.dp)),
                        color = passwordStrength.color,
                        trackColor = MaterialTheme.colorScheme.outlineVariant
                    )
                    Text(
                        text = passwordStrength.label,
                        style = MaterialTheme.typography.labelSmall,
                        color = passwordStrength.color
                    )
                }
            }

            // Confirm password
            OutlinedTextField(
                value = confirmPassword,
                onValueChange = { confirmPassword = it },
                label = { Text(stringResource(R.string.register_confirm_password)) },
                placeholder = { Text(stringResource(R.string.register_confirm_password_placeholder)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(Radii.input),
                visualTransformation = PasswordVisualTransformation(),
                isError = confirmPassword.isNotEmpty() && confirmPassword != password,
                supportingText = {
                    if (confirmPassword.isNotEmpty() && confirmPassword != password) {
                        Text(stringResource(R.string.register_passwords_mismatch))
                    }
                },
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done
                ),
                keyboardActions = KeyboardActions(
                    onDone = { focusManager.clearFocus() }
                )
            )

            // Terms checkbox
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = acceptedTerms,
                    onCheckedChange = { acceptedTerms = it }
                )
                Text(
                    text = stringResource(R.string.register_accept_terms),
                    style = MaterialTheme.typography.bodySmall
                )
            }

            // Error message
            AnimatedVisibility(visible = uiState.error != null) {
                Text(
                    text = uiState.error ?: "",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            // Register button
            val isValid = username.length >= 3 &&
                    email.contains("@") &&
                    password.length >= 8 &&
                    password == confirmPassword &&
                    acceptedTerms

            Button(
                onClick = {
                    focusManager.clearFocus()
                    authViewModel.register(username, email, password)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp),
                enabled = !uiState.isLoading && isValid,
                shape = RoundedCornerShape(Radii.button),
                colors = ButtonDefaults.buttonColors(containerColor = PrimaryBlue)
            ) {
                if (uiState.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = NavbarText,
                        strokeWidth = 2.dp
                    )
                    Spacer(modifier = Modifier.width(Spacing.sm))
                    Text(stringResource(R.string.register_processing))
                } else {
                    Text(
                        text = stringResource(R.string.register_button),
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            // Login link
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = stringResource(R.string.register_already_have_account),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                TextButton(onClick = onNavigateToLogin) {
                    Text(
                        text = stringResource(R.string.register_login_now),
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }

            Spacer(modifier = Modifier.height(Spacing.xl))
        }
    }
}

private data class PasswordStrength(
    val score: Float,
    val label: String,
    val color: androidx.compose.ui.graphics.Color
)

private fun calculatePasswordStrength(password: String): PasswordStrength {
    var score = 0f
    if (password.length >= 8) score += 1f
    if (password.any { it.isUpperCase() }) score += 1f
    if (password.any { it.isLowerCase() }) score += 1f
    if (password.any { it.isDigit() }) score += 1f
    if (password.any { !it.isLetterOrDigit() }) score += 1f

    return when {
        score <= 1f -> PasswordStrength(score, "Very Weak", ErrorRed)
        score <= 2f -> PasswordStrength(score, "Weak", ErrorRed.copy(alpha = 0.7f))
        score <= 3f -> PasswordStrength(score, "Fair", WarningAmber)
        score <= 4f -> PasswordStrength(score, "Good", SuccessGreen.copy(alpha = 0.7f))
        else -> PasswordStrength(score, "Strong", SuccessGreen)
    }
}
