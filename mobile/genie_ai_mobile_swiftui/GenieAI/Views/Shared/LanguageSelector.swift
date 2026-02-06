// LanguageSelector.swift
// Language selection view

import SwiftUI

struct LanguageSelector: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(AppLocaleService.self) private var appLocale
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            ForEach(appLocale.supportedLanguages, id: \.code) { language in
                Button {
                    appLocale.changeLanguage(language.code)
                    dismiss()
                } label: {
                    HStack {
                        Text(language.name)
                            .foregroundColor(theme.primaryTextColor)

                        Spacer()

                        if appLocale.currentLocale == language.code {
                            Image(systemName: "checkmark")
                                .foregroundColor(theme.primaryColor)
                        }
                    }
                }
            }
        }
        .navigationTitle("Display Language")
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    NavigationStack {
        LanguageSelector()
    }
    .environment(ThemeManager())
    .environment(AppLocaleService.shared)
}
