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
    @State private var showLeftSidebar = false
    @State private var showRightSidebar = false
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
    private let mediumScreenThreshold: CGFloat = 768

    var body: some View {
        GeometryReader { geometry in
            let isWideScreen = geometry.size.width >= wideScreenThreshold
            let isMediumScreen = geometry.size.width >= mediumScreenThreshold

            if authService.isAuthenticated {
                // Main App Layout
                mainAppLayout(isWideScreen: isWideScreen, isMediumScreen: isMediumScreen)
            } else {
                // Auth Flow
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
    private func mainAppLayout(isWideScreen: Bool, isMediumScreen: Bool) -> some View {
        ZStack {
            if isWideScreen {
                // 3-Column Layout for wide screens
                HStack(spacing: 0) {
                    // Left Sidebar
                    LeftSidebarView(
                        onConversationSelected: loadConversation,
                        onServiceSelectionChanged: handleServiceSelection
                    )
                    .frame(width: 280)

                    Divider()

                    // Chat View
                    VStack(spacing: 0) {
                        NavBarView(
                            onMenuTapped: {},
                            onNewChatTapped: startNewChat,
                            onProfileTapped: { showProfile = true },
                            onSettingsTapped: { showSettings = true },
                            onLogoutTapped: logout
                        )

                        chatView
                    }

                    Divider()

                    // Right Sidebar
                    RightSidebarView(relatedDocs: relatedDocs, accessToken: currentAccessToken)
                        .frame(width: 280)
                }
            } else {
                // Standard mobile layout with drawers
                ZStack {
                    VStack(spacing: 0) {
                        NavBarView(
                            onMenuTapped: { showLeftSidebar.toggle() },
                            onNewChatTapped: startNewChat,
                            onProfileTapped: { showProfile = true },
                            onSettingsTapped: { showSettings = true },
                            onLogoutTapped: logout
                        )

                        chatView
                    }

                    // Binder tabs (slim edge tabs matching Flutter's _BinderTab)
                    if !showLeftSidebar && !showRightSidebar {
                        // Right binder tab
                        VStack {
                            Spacer().frame(height: 80)
                            Button {
                                withAnimation(theme.animationSmooth) { showRightSidebar = true }
                            } label: {
                                Image(systemName: "chevron.left")
                                    .font(.caption2)
                                    .foregroundColor(theme.navbarTextColor.opacity(0.7))
                                    .frame(width: 10, height: 44)
                                    .background(.thinMaterial)
                                    .clipShape(UnevenRoundedRectangle(
                                        topLeadingRadius: 4,
                                        bottomLeadingRadius: 4
                                    ))
                            }
                            .hapticOnTap(theme: theme)
                            Spacer()
                        }
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    }

                    // Left Sidebar Drawer
                    if showLeftSidebar {
                        sidebarOverlay(isLeft: true) {
                            LeftSidebarView(
                                onConversationSelected: { conversation in
                                    loadConversation(conversation)
                                    showLeftSidebar = false
                                },
                                onServiceSelectionChanged: { categoryId, name, contextLabels in
                                    handleServiceSelection(categoryId: categoryId, name: name, contextLabels: contextLabels)
                                    // Don't close sidebar — allow multi-select (matching Flutter)
                                }
                            )
                        }
                    }

                    // Right Sidebar Drawer
                    if showRightSidebar {
                        sidebarOverlay(isLeft: false) {
                            RightSidebarView(relatedDocs: relatedDocs, accessToken: currentAccessToken)
                        }
                    }
                }
            }
        }
        .task {
            currentAccessToken = await APIService.shared.getToken()
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .sheet(isPresented: $showProfile) {
            UserProfileView()
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
                // Merge unique documents
                let existingUrls = Set(relatedDocs.map { $0.url })
                let newDocs = docs.filter { !existingUrls.contains($0.url) }
                relatedDocs.append(contentsOf: newDocs)
            }
        )
        .id(chatViewKey)
    }

    // MARK: - Sidebar Overlay

    @ViewBuilder
    private func sidebarOverlay<Content: View>(isLeft: Bool, @ViewBuilder content: @escaping () -> Content) -> some View {
        GeometryReader { geometry in
            ZStack(alignment: isLeft ? .leading : .trailing) {
                // Frosted glass backdrop
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .ignoresSafeArea()
                    .onTapGesture {
                        if isLeft {
                            showLeftSidebar = false
                        } else {
                            showRightSidebar = false
                        }
                    }

                // Sidebar Content
                content()
                    .frame(width: min(320, geometry.size.width * 0.85))
                    .background(.regularMaterial)
                    .shadow(
                        color: .black.opacity(0.15),
                        radius: 12,
                        x: isLeft ? 4 : -4,
                        y: 0
                    )
                    .transition(.move(edge: isLeft ? .leading : .trailing))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: showLeftSidebar)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: showRightSidebar)
    }

    // MARK: - Actions

    private func startNewChat() {
        chatViewKey = UUID()
        currentConversation = nil
        relatedDocs = []
        showRightSidebar = false
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
            // Selection cleared
            pendingCategoryId = nil
            pendingCategoryName = nil
            pendingContextLabels = nil
        } else {
            pendingCategoryId = categoryId
            pendingCategoryName = name
            pendingContextLabels = contextLabels
        }
        // Don't recreate ChatView — let it reactively pick up context changes
        // This keeps the sidebar open for multi-select (matching Flutter)
    }

    private func logout() {
        Task {
            await authService.logout()
        }
    }
}

#Preview {
    ContentView()
        .environment(ThemeManager())
        .environment(AuthService())
        .environment(ConnectivityService())
}
