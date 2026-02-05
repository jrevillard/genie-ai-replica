// AboutView.swift
// About screen with app information

import SwiftUI

struct AboutView: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    var body: some View {
        ScrollView {
            VStack(spacing: 32) {
                // App Icon and Name
                VStack(spacing: 16) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 60))
                        .foregroundStyle(theme.navbarGradient)

                    Text(ConfigService.shared.appTitle)
                        .font(.title)
                        .fontWeight(.bold)

                    Text("\(i18n.translate("about.version")) 1.0.0")
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)
                }
                .padding(.top, 40)

                // Description
                Text(i18n.translate("about.description"))
                    .font(.body)
                    .multilineTextAlignment(.center)
                    .foregroundColor(theme.secondaryTextColor)
                    .padding(.horizontal, 32)

                // Tech Stack
                VStack(alignment: .leading, spacing: 16) {
                    Text(i18n.translate("about.techStack"))
                        .font(.headline)

                    VStack(alignment: .leading, spacing: 8) {
                        TechStackRow(name: "SwiftUI", description: "UI Framework")
                        TechStackRow(name: "iOS 17+", description: "@Observable, NavigationStack")
                        TechStackRow(name: "Swift Concurrency", description: "async/await")
                        TechStackRow(name: "Keychain", description: "Secure Token Storage")
                    }
                }
                .padding()
                .background(theme.secondarySurfaceColor)
                .cornerRadius(12)
                .padding(.horizontal)

                Spacer()

                // Copyright
                Text("2024 ITU. \(i18n.translate("about.copyright"))")
                    .font(.caption)
                    .foregroundColor(theme.secondaryTextColor)
                    .padding(.bottom)
            }
        }
        .navigationTitle(i18n.translate("about.title"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct TechStackRow: View {
    @Environment(ThemeManager.self) private var theme

    let name: String
    let description: String

    var body: some View {
        HStack {
            Text(name)
                .font(.subheadline)
                .fontWeight(.medium)

            Spacer()

            Text(description)
                .font(.caption)
                .foregroundColor(theme.secondaryTextColor)
        }
    }
}

#Preview {
    NavigationStack {
        AboutView()
    }
    .environment(ThemeManager())
    .environment(I18nService())
}
