package com.genieai.mobile.ui.screens.main

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.genieai.mobile.R
import com.genieai.mobile.service.ConfigService
import com.genieai.mobile.service.ConnectivityService
import com.genieai.mobile.ui.screens.chat.ChatScreen
import com.genieai.mobile.ui.screens.sidebar.ChatHistorySheet
import com.genieai.mobile.ui.screens.sidebar.InfoResourcesSheet
import com.genieai.mobile.ui.screens.sidebar.ServiceTreeSheet
import com.genieai.mobile.ui.theme.*
import com.genieai.mobile.viewmodel.AuthViewModel
import com.genieai.mobile.viewmodel.ChatHistoryViewModel
import com.genieai.mobile.viewmodel.ChatViewModel
import com.genieai.mobile.viewmodel.ServiceTreeViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    onNavigateToProfile: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToAbout: () -> Unit,
    onLogout: () -> Unit,
    authViewModel: AuthViewModel = viewModel(),
    chatViewModel: ChatViewModel = viewModel(),
    chatHistoryViewModel: ChatHistoryViewModel = viewModel(),
    serviceTreeViewModel: ServiceTreeViewModel = viewModel()
) {
    val context = LocalContext.current
    val authState by authViewModel.uiState.collectAsState()
    val chatState by chatViewModel.uiState.collectAsState()
    val isOnline by ConnectivityService.isOnline.collectAsState()

    var showChatHistory by remember { mutableStateOf(false) }
    var showKnowledgeAreas by remember { mutableStateOf(false) }
    var showInfoResources by remember { mutableStateOf(false) }
    var showProfileMenu by remember { mutableStateOf(false) }

    // Initialize
    LaunchedEffect(Unit) {
        ConfigService.init(context)
        ConnectivityService.init(context)
        // Re-hydrate user from token (AuthViewModel is a new instance after navigation)
        authViewModel.fetchCurrentUser()
    }

    LaunchedEffect(authState.user) {
        authState.user?.id?.let { userId ->
            chatViewModel.setUserId(userId)
            chatHistoryViewModel.loadConversations(userId)
        }
    }

    val quickHelpButtons = remember { ConfigService.getQuickHelpButtons() }
    val quickHelpColumns = remember { ConfigService.getQuickHelpColumns() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = ConfigService.appTitle,
                        fontWeight = FontWeight.Bold,
                        color = NavbarText
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = PrimaryBlue
                ),
                navigationIcon = {
                    // Connectivity indicator
                    IconButton(onClick = { }) {
                        Icon(
                            if (isOnline) Icons.Default.Wifi else Icons.Default.WifiOff,
                            contentDescription = null,
                            tint = if (isOnline) NavbarText else WarningAmber
                        )
                    }
                },
                actions = {
                    // New chat
                    IconButton(onClick = { chatViewModel.startNewChat() }) {
                        Icon(
                            Icons.AutoMirrored.Filled.Chat,
                            contentDescription = stringResource(R.string.chatbot_new_chat),
                            tint = NavbarText
                        )
                    }

                    // Chat history
                    IconButton(onClick = { showChatHistory = true }) {
                        Icon(
                            Icons.Default.History,
                            contentDescription = stringResource(R.string.sidebar_chat_history),
                            tint = NavbarText
                        )
                    }

                    // Knowledge areas
                    IconButton(onClick = { showKnowledgeAreas = true }) {
                        Icon(
                            Icons.Default.Category,
                            contentDescription = stringResource(R.string.sidebar_knowledge_areas),
                            tint = NavbarText
                        )
                    }

                    // Info & Resources
                    IconButton(onClick = { showInfoResources = true }) {
                        Icon(
                            Icons.Default.Info,
                            contentDescription = stringResource(R.string.sidebar_title),
                            tint = NavbarText
                        )
                    }

                    // Profile menu
                    Box {
                        IconButton(onClick = { showProfileMenu = true }) {
                            Icon(
                                Icons.Default.AccountCircle,
                                contentDescription = stringResource(R.string.nav_profile),
                                tint = NavbarText
                            )
                        }
                        DropdownMenu(
                            expanded = showProfileMenu,
                            onDismissRequest = { showProfileMenu = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.nav_profile)) },
                                onClick = {
                                    showProfileMenu = false
                                    onNavigateToProfile()
                                },
                                leadingIcon = {
                                    Icon(Icons.Default.Person, contentDescription = null)
                                }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.nav_settings)) },
                                onClick = {
                                    showProfileMenu = false
                                    onNavigateToSettings()
                                },
                                leadingIcon = {
                                    Icon(Icons.Default.Settings, contentDescription = null)
                                }
                            )
                            HorizontalDivider()
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        stringResource(R.string.nav_logout),
                                        color = ErrorRed
                                    )
                                },
                                onClick = {
                                    showProfileMenu = false
                                    authViewModel.logout()
                                    onLogout()
                                },
                                leadingIcon = {
                                    Icon(
                                        Icons.Default.Logout,
                                        contentDescription = null,
                                        tint = ErrorRed
                                    )
                                }
                            )
                        }
                    }
                }
            )
        }
    ) { paddingValues ->
        ChatScreen(
            uiState = chatState,
            quickHelpButtons = quickHelpButtons,
            quickHelpColumns = quickHelpColumns,
            isOnline = isOnline,
            onSendMessage = { chatViewModel.sendMessage(it) },
            onQuickHelpClick = { button ->
                chatViewModel.sendQuickHelp(
                    button.visibleText,
                    button.hiddenPrompt,
                    button.category
                )
            },
            onFeedbackSubmit = { queryId, rating, comment ->
                chatViewModel.submitFeedback(queryId, rating, comment)
            },
            onRemoveContext = { chatViewModel.clearContext() },
            modifier = Modifier.padding(paddingValues)
        )
    }

    // Bottom sheets
    if (showChatHistory) {
        ChatHistorySheet(
            chatHistoryViewModel = chatHistoryViewModel,
            onDismiss = { showChatHistory = false },
            onConversationSelected = { conversation ->
                chatViewModel.loadConversation(
                    conversation.id,
                    conversation.title,
                    conversation.messages
                )
                showChatHistory = false
            }
        )
    }

    if (showKnowledgeAreas) {
        ServiceTreeSheet(
            serviceTreeViewModel = serviceTreeViewModel,
            onDismiss = { showKnowledgeAreas = false },
            onSelectionApplied = { categoryId, contextLabels ->
                chatViewModel.setCategory(
                    categoryId,
                    null,
                    contextLabels
                )
            }
        )
    }

    if (showInfoResources) {
        InfoResourcesSheet(
            relatedDocuments = chatState.relatedDocuments,
            onDismiss = { showInfoResources = false }
        )
    }
}
