// LoadingView.swift
// Full-screen loading indicator

import SwiftUI

struct LoadingView: View {
    @Environment(ThemeManager.self) private var theme

    var message: String?

    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.5)

            Text(message ?? String(localized: "Loading..."))
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
}
