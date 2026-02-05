// GenieAIApp.swift
// Main entry point for the GenieAI SwiftUI application

import SwiftUI

@main
struct GenieAIApp: App {
    @State private var themeManager = ThemeManager()
    @State private var i18nService = I18nService()
    @State private var authService = AuthService()
    @State private var connectivityService = ConnectivityService()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(themeManager)
                .environment(i18nService)
                .environment(authService)
                .environment(connectivityService)
                .preferredColorScheme(themeManager.colorScheme)
                .environment(\.layoutDirection, i18nService.isRtl ? .rightToLeft : .leftToRight)
        }
    }
}
