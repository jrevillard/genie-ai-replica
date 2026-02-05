// ThemeManager.swift
// Manages theme state and provides colors for the app

import SwiftUI

enum AppTheme: String, CaseIterable {
    case light
    case dark
    case system

    var displayName: String {
        switch self {
        case .light: return "Light"
        case .dark: return "Dark"
        case .system: return "System"
        }
    }
}

@Observable
class ThemeManager {
    var currentTheme: AppTheme = .system {
        didSet {
            UserDefaults.standard.set(currentTheme.rawValue, forKey: "app_theme")
        }
    }

    var fontSize: Double = 50.0 {
        didSet {
            UserDefaults.standard.set(fontSize, forKey: "app_font_size")
        }
    }

    var fontScale: Double {
        fontSize / 50.0
    }

    private let configService = ConfigService.shared

    init() {
        if let saved = UserDefaults.standard.string(forKey: "app_theme"),
           let theme = AppTheme(rawValue: saved) {
            currentTheme = theme
        }
        let savedFontSize = UserDefaults.standard.double(forKey: "app_font_size")
        if savedFontSize > 0 {
            fontSize = savedFontSize
        }
    }

    // MARK: - Color Scheme

    var colorScheme: ColorScheme? {
        switch currentTheme {
        case .light: return .light
        case .dark: return .dark
        case .system: return nil
        }
    }

    // MARK: - Theme Colors

    var primaryColor: Color {
        Color(hex: configService.primaryColor)
    }

    var secondaryColor: Color {
        Color(hex: configService.secondaryColor)
    }

    var backgroundColor: Color {
        Color(hex: configService.backgroundColor)
    }

    var textColor: Color {
        Color(hex: configService.textColor)
    }

    var navbarGradient: LinearGradient {
        LinearGradient(
            colors: [
                Color(hex: configService.navbarGradientStart),
                Color(hex: configService.navbarGradientEnd)
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
    }

    var navbarTextColor: Color {
        Color(hex: configService.navbarTextColor)
    }

    // MARK: - Semantic Colors

    var surfaceColor: Color {
        Color(.systemBackground)
    }

    var secondarySurfaceColor: Color {
        Color(.secondarySystemBackground)
    }

    var primaryTextColor: Color {
        Color(.label)
    }

    var secondaryTextColor: Color {
        Color(.secondaryLabel)
    }

    var errorColor: Color {
        Color.red
    }

    var successColor: Color {
        Color.green
    }

    var warningColor: Color {
        Color.orange
    }

    // MARK: - Methods

    func setTheme(_ theme: AppTheme) {
        currentTheme = theme
    }

    func toggleTheme() {
        switch currentTheme {
        case .light:
            currentTheme = .dark
        case .dark:
            currentTheme = .light
        case .system:
            currentTheme = .light
        }
    }

    func setFontSize(_ size: Double) {
        fontSize = max(30, min(100, size))
    }
}
