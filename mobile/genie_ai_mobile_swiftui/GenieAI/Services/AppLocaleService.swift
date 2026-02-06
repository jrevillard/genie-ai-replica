// AppLocaleService.swift
// Locale management that observes the iOS per-app language setting (Settings > Apps > GenieAI > Language)

import SwiftUI

@Observable
class AppLocaleService {
    static let shared = AppLocaleService()

    /// Current language code, derived from the iOS per-app language setting
    private(set) var currentLocale: String

    /// Display name for the current language (e.g. "English", "Français"), localized to itself
    var currentLanguageName: String {
        let id = Locale(identifier: currentLocale)
        return id.localizedString(forLanguageCode: currentLocale)?.localizedCapitalized ?? currentLocale
    }

    var isRtl: Bool {
        currentLocale == "ar" || currentLocale == "he" || currentLocale == "fa"
    }

    /// Locale for `.environment(\.locale, ...)` — drives SwiftUI auto-localization
    var locale: Locale {
        Locale(identifier: currentLocale)
    }

    /// Bundle for the current locale's .lproj — used by NSLocalizedString for dynamic keys
    var localizedBundle: Bundle {
        guard let path = Bundle.main.path(forResource: currentLocale, ofType: "lproj"),
              let bundle = Bundle(path: path) else {
            return Bundle.main
        }
        return bundle
    }

    init() {
        // Read the system per-app language preference
        currentLocale = Bundle.main.preferredLocalizations.first ?? "en"
    }

    /// Opens the app's page in iOS Settings where the user can change the language
    static func openLanguageSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }
}
