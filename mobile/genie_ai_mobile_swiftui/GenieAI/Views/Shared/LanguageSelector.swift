// LanguageSelector.swift
// Language selection view

import SwiftUI

struct LanguageSelector: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            ForEach(i18n.supportedLanguages, id: \.code) { language in
                Button {
                    i18n.changeLanguage(language.code)
                    dismiss()
                } label: {
                    HStack {
                        Text(language.name)
                            .foregroundColor(theme.primaryTextColor)

                        Spacer()

                        if i18n.currentLocale == language.code {
                            Image(systemName: "checkmark")
                                .foregroundColor(theme.primaryColor)
                        }
                    }
                }
            }
        }
        .navigationTitle(i18n.translate("settings.displayLanguage"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    NavigationStack {
        LanguageSelector()
    }
    .environment(ThemeManager())
    .environment(I18nService())
}
