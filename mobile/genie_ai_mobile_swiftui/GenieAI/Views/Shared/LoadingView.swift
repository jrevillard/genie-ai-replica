// LoadingView.swift
// Full-screen loading indicator

import SwiftUI

struct LoadingView: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    var message: String?

    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.5)

            Text(message ?? i18n.translate("common.loading"))
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.surfaceColor.opacity(0.9))
    }
}

#Preview {
    LoadingView()
        .environment(ThemeManager())
        .environment(I18nService())
}
