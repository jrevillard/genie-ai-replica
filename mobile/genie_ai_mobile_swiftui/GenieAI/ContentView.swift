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
    @Environment(I18nService.self) private var i18n
    @Environment(ConnectivityService.self) private var connectivity

    @State private var navigationPath = NavigationPath()
    @State private var showLeftSidebar = false
    @State private var showRightSidebar = false
    @State private var showSettings = false
    @State private var showProfile = false
    @State private var currentConversation: Conversation?
    @State private var chatViewKey = UUID()

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
                        onCategorySelected: selectCategory,
                        onServiceSelected: selectService
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

                        ChatView(onNewChat: startNewChat)
                            .id(chatViewKey)
                    }

                    Divider()

                    // Right Sidebar
                    RightSidebarView(relatedDocs: [], faqItems: [])
                        .frame(width: 280)
                }
            } else {
                // Standard mobile layout with drawers
                VStack(spacing: 0) {
                    NavBarView(
                        onMenuTapped: { showLeftSidebar.toggle() },
                        onNewChatTapped: startNewChat,
                        onProfileTapped: { showProfile = true },
                        onSettingsTapped: { showSettings = true },
                        onLogoutTapped: logout
                    )

                    ChatView(onNewChat: startNewChat)
                        .id(chatViewKey)
                }

                // Left Sidebar Drawer
                if showLeftSidebar {
                    sidebarOverlay(isLeft: true) {
                        LeftSidebarView(
                            onConversationSelected: { conversation in
                                loadConversation(conversation)
                                showLeftSidebar = false
                            },
                            onCategorySelected: { category in
                                selectCategory(category)
                                showLeftSidebar = false
                            },
                            onServiceSelected: { service in
                                selectService(service)
                                showLeftSidebar = false
                            }
                        )
                    }
                }
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .sheet(isPresented: $showProfile) {
            UserProfileView()
        }
    }

    // MARK: - Sidebar Overlay

    @ViewBuilder
    private func sidebarOverlay<Content: View>(isLeft: Bool, @ViewBuilder content: @escaping () -> Content) -> some View {
        GeometryReader { geometry in
            ZStack(alignment: isLeft ? .leading : .trailing) {
                // Backdrop
                Color.black.opacity(0.4)
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
                    .background(theme.surfaceColor)
                    .transition(.move(edge: isLeft ? .leading : .trailing))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: showLeftSidebar)
        .animation(.easeInOut(duration: 0.25), value: showRightSidebar)
    }

    // MARK: - Actions

    private func startNewChat() {
        chatViewKey = UUID()
        currentConversation = nil
    }

    private func loadConversation(_ conversation: Conversation) {
        currentConversation = conversation
        chatViewKey = UUID()
    }

    private func selectCategory(_ category: ServiceCategory) {
        // TODO: Add category context to chat
        print("Selected category: \(category.name)")
    }

    private func selectService(_ service: ServiceItem) {
        // TODO: Add service context to chat
        print("Selected service: \(service.name)")
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
        .environment(I18nService())
        .environment(AuthService())
        .environment(ConnectivityService())
}
