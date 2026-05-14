// GenieAIApp.swift
// Main entry point for the GenieAI SwiftUI application

import SwiftUI

@main
struct GenieAIApp: App {
    @State private var themeManager = ThemeManager()
    @State private var appLocale = AppLocaleService.shared
    @State private var authService = AuthService()
    @State private var connectivityService = ConnectivityService()
    @State private var localRAGBridge = LocalRAGBridge()
    @State private var offlineLibrary = OfflineLibraryService.shared
    @State private var localRAGIndexer: LocalRAGIndexer
    @State private var relatedDocsStore = RelatedDocsStore()

    init() {
        let bridge = LocalRAGBridge()
        let library = OfflineLibraryService.shared
        _localRAGBridge = State(initialValue: bridge)
        _offlineLibrary = State(initialValue: library)
        _localRAGIndexer = State(initialValue: LocalRAGIndexer(bridge: bridge, library: library))
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(themeManager)
                .environment(appLocale)
                .environment(authService)
                .environment(connectivityService)
                .environment(localRAGBridge)
                .environment(offlineLibrary)
                .environment(localRAGIndexer)
                .environment(relatedDocsStore)
                .environment(\.locale, appLocale.locale)
                .preferredColorScheme(themeManager.colorScheme)
                .environment(\.layoutDirection, appLocale.isRtl ? .rightToLeft : .leftToRight)
                .fontDesign(.rounded)
                .task {
                    await localRAGBridge.initialize()
                    // After the LLM/embedding stack is ready, re-index any
                    // cached PDFs from disk into the (in-memory) vector store.
                    await localRAGIndexer.reindexLibrary()
                }
        }
    }
}
