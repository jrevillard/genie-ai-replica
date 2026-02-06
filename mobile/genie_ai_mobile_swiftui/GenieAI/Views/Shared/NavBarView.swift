// NavBarView.swift
// Top navigation bar

import SwiftUI

struct NavBarView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(ConnectivityService.self) private var connectivity

    var onMenuTapped: () -> Void
    var onNewChatTapped: () -> Void
    var onProfileTapped: () -> Void
    var onSettingsTapped: () -> Void
    var onLogoutTapped: () -> Void

    var body: some View {
        HStack(spacing: 16) {
            // Menu Button
            Button(action: onMenuTapped) {
                Image(systemName: "line.3.horizontal")
                    .font(.title2)
                    .foregroundColor(theme.navbarTextColor)
            }

            // App Title
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.title3)

                Text(ConfigService.shared.appTitle)
                    .font(.headline)
                    .fontWeight(.bold)
            }
            .foregroundColor(theme.navbarTextColor)

            Spacer()

            // Connectivity Status
            if !connectivity.isOnline {
                Image(systemName: "wifi.slash")
                    .foregroundColor(.orange)
            }

            // New Chat
            Button(action: onNewChatTapped) {
                Image(systemName: "plus.message")
                    .font(.title3)
                    .foregroundColor(theme.navbarTextColor)
            }

            // Profile Menu
            Menu {
                Button {
                    onProfileTapped()
                } label: {
                    HStack {
                        Image(systemName: "person")
                        Text("My Profile")
                    }
                }

                Button {
                    onSettingsTapped()
                } label: {
                    HStack {
                        Image(systemName: "gear")
                        Text("Settings")
                    }
                }

                Divider()

                Button(role: .destructive, action: onLogoutTapped) {
                    HStack {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                        Text("Log Out")
                    }
                }
            } label: {
                Image(systemName: "person.circle.fill")
                    .font(.title2)
                    .foregroundColor(theme.navbarTextColor)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
        .background(theme.navbarGradient)
    }
}

#Preview {
    VStack {
        NavBarView(
            onMenuTapped: {},
            onNewChatTapped: {},
            onProfileTapped: {},
            onSettingsTapped: {},
            onLogoutTapped: {}
        )
        Spacer()
    }
    .environment(AuthService())
    .environment(ThemeManager())
    .environment(ConnectivityService())
}
