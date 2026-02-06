// GenieAIApp.swift
// Main entry point for the GenieAI SwiftUI application

import SwiftUI

@main
struct GenieAIApp: App {
    @State private var themeManager = ThemeManager()
    @State private var appLocale = AppLocaleService.shared
    @State private var authService = AuthService()
    @State private var connectivityService = ConnectivityService()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(themeManager)
                .environment(appLocale)
                .environment(authService)
                .environment(connectivityService)
                .environment(\.locale, appLocale.locale)
                .preferredColorScheme(themeManager.colorScheme)
                .environment(\.layoutDirection, appLocale.isRtl ? .rightToLeft : .leftToRight)
                .fontDesign(.rounded)
        }
    }
}
