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
        // Load user preferences (default to true if not set)
        if UserDefaults.standard.object(forKey: "app_animations_enabled") != nil {
            animationsEnabled = UserDefaults.standard.bool(forKey: "app_animations_enabled")
        }
        if UserDefaults.standard.object(forKey: "app_haptics_enabled") != nil {
            hapticsEnabled = UserDefaults.standard.bool(forKey: "app_haptics_enabled")
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

    // MARK: - Spacing Tokens

    var spacingXS: CGFloat { 4 }
    var spacingSM: CGFloat { 8 }
    var spacingMD: CGFloat { 12 }
    var spacingLG: CGFloat { 16 }
    var spacingXL: CGFloat { 24 }
    var spacingXXL: CGFloat { 32 }

    // MARK: - Corner Radius Tokens

    var radiusSM: CGFloat { 8 }
    var radiusMD: CGFloat { 12 }
    var radiusLG: CGFloat { 16 }
    var radiusXL: CGFloat { 20 }
    var radiusFull: CGFloat { 999 }

    // MARK: - Shadow Tokens

    struct ShadowStyle {
        let color: Color
        let radius: CGFloat
        let x: CGFloat
        let y: CGFloat
    }

    var shadowSoft: ShadowStyle { ShadowStyle(color: .black.opacity(0.06), radius: 8, x: 0, y: 2) }
    var shadowMedium: ShadowStyle { ShadowStyle(color: .black.opacity(0.10), radius: 12, x: 0, y: 4) }
    var shadowStrong: ShadowStyle { ShadowStyle(color: .black.opacity(0.15), radius: 20, x: 0, y: 8) }
    var shadowGlow: ShadowStyle { ShadowStyle(color: primaryColor.opacity(0.20), radius: 12, x: 0, y: 4) }

    // MARK: - User Preferences

    var animationsEnabled: Bool = true {
        didSet { UserDefaults.standard.set(animationsEnabled, forKey: "app_animations_enabled") }
    }

    var hapticsEnabled: Bool = true {
        didSet { UserDefaults.standard.set(hapticsEnabled, forKey: "app_haptics_enabled") }
    }

    // MARK: - Animation Tokens

    var animationQuick: Animation? { animationsEnabled ? .easeOut(duration: 0.15) : nil }
    var animationStandard: Animation? { animationsEnabled ? .easeInOut(duration: 0.25) : nil }
    var animationSmooth: Animation? { animationsEnabled ? .spring(response: 0.35, dampingFraction: 0.8) : nil }
    var animationBounce: Animation? { animationsEnabled ? .spring(response: 0.4, dampingFraction: 0.65) : nil }

    // MARK: - Glass Surface Colors

    var glassBackground: Color { surfaceColor.opacity(0.7) }
    var glassBorder: Color { primaryColor.opacity(0.12) }

    // MARK: - Brand Colors

    var whatsAppGreen: Color { Color(red: 37/255, green: 211/255, blue: 102/255) }
    var facebookBlue: Color { Color(red: 0.23, green: 0.35, blue: 0.60) }

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
