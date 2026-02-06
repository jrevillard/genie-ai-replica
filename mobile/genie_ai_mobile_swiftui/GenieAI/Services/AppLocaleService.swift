// AppLocaleService.swift
// Minimal locale management for runtime language switching with String Catalogs

import SwiftUI

@Observable
class AppLocaleService {
    static let shared = AppLocaleService()

    var currentLocale: String = "en" {
        didSet {
            UserDefaults.standard.set(currentLocale, forKey: "app_locale")
        }
    }

    let supportedLanguages: [(code: String, name: String)] = [
        ("en", "English"),
        ("ar", "Arabic"),
        ("de", "German"),
        ("es", "Spanish"),
        ("fr", "French"),
        ("id", "Indonesian"),
        ("sw", "Kiswahili"),
        ("pt", "Portuguese"),
        ("zh", "Chinese"),
        ("ru", "Russian"),
        ("th", "Thai")
    ]

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
        if let saved = UserDefaults.standard.string(forKey: "app_locale") {
            currentLocale = saved
        }
    }

    func changeLanguage(_ languageCode: String) {
        guard supportedLanguages.contains(where: { $0.code == languageCode }) else {
            return
        }
        guard currentLocale != languageCode else {
            return
        }
        currentLocale = languageCode
    }
}
