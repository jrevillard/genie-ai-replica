// I18nService.swift
// Internationalization service with dictionary-based translations

import SwiftUI

@Observable
class I18nService {
    var currentLocale: String = "en" {
        didSet {
            UserDefaults.standard.set(currentLocale, forKey: "app_locale")
            print("[I18nService] Locale updated to \(currentLocale)")
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

    init() {
        if let saved = UserDefaults.standard.string(forKey: "app_locale") {
            currentLocale = saved
        }
        print("[I18nService] Initialized with locale: \(currentLocale)")
    }

    func changeLanguage(_ languageCode: String) {
        guard supportedLanguages.contains(where: { $0.code == languageCode }) else {
            print("[I18nService] Language \(languageCode) not supported")
            return
        }

        guard currentLocale != languageCode else {
            print("[I18nService] Language is already \(languageCode)")
            return
        }

        currentLocale = languageCode
    }

    func translate(_ key: String, args: [String: String]? = nil) -> String {
        // Get translations for current locale
        var translations = getTranslations(for: currentLocale)

        // Navigate nested keys
        var value = getValueFromDict(key: key, dict: translations)

        // Fallback to English if not found
        if value == nil && currentLocale != "en" {
            translations = getTranslations(for: "en")
            value = getValueFromDict(key: key, dict: translations)
        }

        // Return key if not found
        guard var result = value as? String else {
            return key
        }

        // Handle argument substitution
        if let args = args {
            for (argKey, argValue) in args {
                result = result.replacingOccurrences(of: "{\(argKey)}", with: argValue)
            }
        }

        return result
    }

    private func getValueFromDict(key: String, dict: [String: Any]) -> Any? {
        let keys = key.split(separator: ".").map(String.init)
        var current: Any = dict

        for k in keys {
            guard let currentDict = current as? [String: Any],
                  let nextValue = currentDict[k] else {
                return nil
            }
            current = nextValue
        }

        return current
    }

    private func getTranslations(for locale: String) -> [String: Any] {
        switch locale {
        case "en": return EnLocale.translations
        case "ar": return ArLocale.translations
        case "de": return DeLocale.translations
        case "es": return EsLocale.translations
        case "fr": return FrLocale.translations
        case "id": return IdLocale.translations
        case "pt": return PtLocale.translations
        case "ru": return RuLocale.translations
        case "sw": return SwLocale.translations
        case "th": return ThLocale.translations
        case "zh": return ZhLocale.translations
        default: return EnLocale.translations
        }
    }
}

// MARK: - Global Translation Function

func tr(_ key: String, args: [String: String]? = nil) -> String {
    // This will be called with the environment I18nService in views
    // For now, use a shared instance for convenience
    return I18nServiceShared.shared.translate(key, args: args)
}

// Shared instance for global tr() function
class I18nServiceShared {
    static let shared = I18nService()
}
