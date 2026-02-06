// ContentView.swift
// Main navigation container with responsive layout

import SwiftUI

enum AppRoute: Hashable {
    case login
    case register
    case passwordReset
    case passwordResetConfirm(token: String?)
    case registrationSuccess(email: String)
    case chat
    case profile
    case settings
    case about
}

struct ContentView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(ConnectivityService.self) private var connectivity

    @State private var navigationPath = NavigationPath()
    @State private var showHistorySheet = false
    @State private var showServicesSheet = false
    @State private var showInfoSheet = false
    @State private var showSettings = false
    @State private var showProfile = false
    @State private var currentConversation: Conversation?
    @State private var chatViewKey = UUID()
    @State private var relatedDocs: [DocumentItem] = []
    @State private var currentAccessToken: String?

    // Category/service context to pass to ChatView
    @State private var pendingCategoryId: String?
    @State private var pendingCategoryName: String?
    @State private var pendingContextLabels: String?

    // For wide screens
    private let wideScreenThreshold: CGFloat = 1200

    var body: some View {
        GeometryReader { geometry in
            let isWideScreen = geometry.size.width >= wideScreenThreshold

            if authService.isAuthenticated {
                mainAppLayout(isWideScreen: isWideScreen)
            } else {
                authFlow
            }
        }
    }

    // MARK: - Auth Flow

    @ViewBuilder
    private var authFlow: some View {
        NavigationStack(path: $navigationPath) {
            LoginView(
                onRegisterTapped: { navigationPath.append(AppRoute.register) },
                onForgotPasswordTapped: { navigationPath.append(AppRoute.passwordReset) },
                onLoginSuccess: { /* Auth state will update automatically */ }
            )
            .navigationDestination(for: AppRoute.self) { route in
                switch route {
                case .register:
                    RegisterView(
                        onBackToLogin: { navigationPath.removeLast() },
                        onRegistrationSuccess: { email in
                            navigationPath.append(AppRoute.registrationSuccess(email: email))
                        }
                    )

                case .passwordReset:
                    PasswordResetView(
                        onBackToLogin: { navigationPath.removeLast() }
                    )

                case .passwordResetConfirm(let token):
                    PasswordResetConfirmView(
                        resetToken: token,
                        onBackToLogin: { navigationPath = NavigationPath() }
                    )

                case .registrationSuccess(let email):
                    RegistrationSuccessView(
                        email: email,
                        onBackToLogin: { navigationPath = NavigationPath() }
                    )

                default:
                    EmptyView()
                }
            }
        }
    }

    // MARK: - Main App Layout

    @ViewBuilder
    private func mainAppLayout(isWideScreen: Bool) -> some View {
        if isWideScreen {
            wideScreenLayout
        } else {
            mobileLayout
        }
    }

    // MARK: - Mobile Layout

    @ViewBuilder
    private var mobileLayout: some View {
        NavigationStack {
            chatView
                .navigationTitle(ConfigService.shared.appTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItemGroup(placement: .topBarLeading) {
                        Button {
                            showHistorySheet = true
                        } label: {
                            Image(systemName: "clock.arrow.trianglehead.counterclockwise.rotate.90")
                        }
                        .hapticOnTap(theme: theme)
                        .accessibilityLabel("Chat History")

                        Button {
                            showInfoSheet = true
                        } label: {
                            Image(systemName: "info.circle")
                        }
                        .hapticOnTap(theme: theme)
                        .accessibilityLabel("Info & Resources")
                    }

                    ToolbarItemGroup(placement: .topBarTrailing) {
                        if !connectivity.isOnline {
                            Image(systemName: "wifi.slash")
                                .foregroundColor(.orange)
                                .accessibilityLabel("No internet connection")
                        }

                        Button {
                            showServicesSheet = true
                        } label: {
                            Image(systemName: "books.vertical")
                        }
                        .hapticOnTap(theme: theme)
                        .accessibilityLabel("Knowledge Areas")

                        Button(action: startNewChat) {
                            Image(systemName: "plus.message")
                        }
                        .hapticOnTap(theme: theme)
                        .accessibilityLabel("New Chat")

                        profileMenu
                    }
                }
                .tint(theme.primaryColor)
                .sheet(isPresented: $showHistorySheet) {
                    NavigationStack {
                        ChatHistorySheetContent(
                            onConversationSelected: { conversation in
                                loadConversation(conversation)
                                showHistorySheet = false
                            }
                        )
                        .navigationTitle("Chat History")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button { showHistorySheet = false } label: {
                                    Image(systemName: "checkmark")
                                        .fontWeight(.semibold)
                                }
                                .accessibilityLabel(Text("Done"))
                            }
                        }
                    }
                    .tint(theme.primaryColor)
                }
                .sheet(isPresented: $showServicesSheet) {
                    NavigationStack {
                        ServicesSheetContent(
                            onSelectionChanged: handleServiceSelection
                        )
                        .navigationTitle("Knowledge Areas")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button { showServicesSheet = false } label: {
                                    Image(systemName: "checkmark")
                                        .fontWeight(.semibold)
                                }
                                .accessibilityLabel(Text("Done"))
                            }
                        }
                    }
                    .tint(theme.primaryColor)
                }
                .sheet(isPresented: $showInfoSheet) {
                    NavigationStack {
                        RightSidebarView(relatedDocs: relatedDocs, accessToken: currentAccessToken, showHeader: false)
                            .navigationTitle("Info & Resources")
                            .navigationBarTitleDisplayMode(.inline)
                            .toolbar {
                                ToolbarItem(placement: .confirmationAction) {
                                    Button { showInfoSheet = false } label: {
                                        Image(systemName: "checkmark")
                                            .fontWeight(.semibold)
                                    }
                                    .accessibilityLabel(Text("Done"))
                                }
                            }
                    }
                    .tint(theme.primaryColor)
                }
                .sheet(isPresented: $showSettings) {
                    SettingsView()
                }
                .sheet(isPresented: $showProfile) {
                    UserProfileView()
                }
        }
        .task {
            currentAccessToken = await APIService.shared.getToken()
        }
    }

    // MARK: - Wide Screen Layout

    @ViewBuilder
    private var wideScreenLayout: some View {
        NavigationStack {
            HStack(spacing: 0) {
                LeftSidebarView(
                    onConversationSelected: loadConversation,
                    onServiceSelectionChanged: handleServiceSelection
                )
                .frame(width: 280)

                Divider()

                chatView

                Divider()

                RightSidebarView(relatedDocs: relatedDocs, accessToken: currentAccessToken)
                    .frame(width: 280)
            }
            .navigationTitle(ConfigService.shared.appTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if !connectivity.isOnline {
                        Image(systemName: "wifi.slash")
                            .foregroundColor(.orange)
                            .accessibilityLabel("No internet connection")
                    }

                    Button(action: startNewChat) {
                        Image(systemName: "plus.message")
                    }
                    .hapticOnTap(theme: theme)
                    .accessibilityLabel("New Chat")

                    profileMenu
                }
            }
            .tint(theme.primaryColor)
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .sheet(isPresented: $showProfile) {
                UserProfileView()
            }
        }
        .task {
            currentAccessToken = await APIService.shared.getToken()
        }
    }

    // MARK: - Profile Menu

    @ViewBuilder
    private var profileMenu: some View {
        Menu {
            Button {
                showProfile = true
            } label: {
                SwiftUI.Label("My Profile", systemImage: "person")
            }

            Button {
                showSettings = true
            } label: {
                SwiftUI.Label("Settings", systemImage: "gear")
            }

            Divider()

            Button(role: .destructive, action: logout) {
                SwiftUI.Label("Log Out", systemImage: "rectangle.portrait.and.arrow.right")
            }
        } label: {
            Image(systemName: "person.circle.fill")
                .font(.title3)
        }
    }

    // MARK: - Chat View Builder

    @ViewBuilder
    private var chatView: some View {
        ChatView(
            initialConversation: currentConversation,
            initialCategoryId: pendingCategoryId,
            initialCategoryName: pendingCategoryName,
            initialContextLabels: pendingContextLabels,
            onNewChat: { /* handled by startNewChat */ },
            onRelatedDocumentsUpdate: { docs in
                let existingUrls = Set(relatedDocs.map { $0.url })
                let newDocs = docs.filter { !existingUrls.contains($0.url) }
                relatedDocs.append(contentsOf: newDocs)
            }
        )
        .id(chatViewKey)
    }

    // MARK: - Actions

    private func startNewChat() {
        chatViewKey = UUID()
        currentConversation = nil
        relatedDocs = []
        pendingCategoryId = nil
        pendingCategoryName = nil
        pendingContextLabels = nil
    }

    private func loadConversation(_ conversation: Conversation) {
        currentConversation = conversation
        relatedDocs = []
        chatViewKey = UUID()
    }

    private func handleServiceSelection(categoryId: String, name: String, contextLabels: String) {
        if categoryId.isEmpty {
            pendingCategoryId = nil
            pendingCategoryName = nil
            pendingContextLabels = nil
        } else {
            pendingCategoryId = categoryId
            pendingCategoryName = name
            pendingContextLabels = contextLabels
        }
    }

    private func logout() {
        Task {
            await authService.logout()
        }
    }
}

// MARK: - Sheet Content Wrappers

private struct ChatHistorySheetContent: View {
    @State private var searchText = ""
    var onConversationSelected: ((Conversation) -> Void)?

    var body: some View {
        ChatHistoryView(searchText: searchText, onConversationSelected: onConversationSelected)
            .searchable(text: $searchText, prompt: "Search chats...")
    }
}

private struct ServicesSheetContent: View {
    @State private var searchText = ""
    var onSelectionChanged: ((_ categoryId: String, _ name: String, _ contextLabels: String) -> Void)?

    var body: some View {
        ServiceTreeView(searchText: searchText, onSelectionChanged: onSelectionChanged)
            .searchable(text: $searchText, prompt: "Search services...")
    }
}

#Preview {
    ContentView()
        .environment(ThemeManager())
        .environment(AuthService())
        .environment(ConnectivityService())
}
