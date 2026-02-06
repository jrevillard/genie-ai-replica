// RegistrationSuccessView.swift
// Success screen after registration

import SwiftUI

struct RegistrationSuccessView: View {
    @Environment(ThemeManager.self) private var theme

    let email: String
    var onBackToLogin: () -> Void

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // Success Icon
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 80))
                .foregroundColor(theme.successColor)

            // Title
            Text("Registration Successful!")
                .font(.title)
                .fontWeight(.bold)
                .foregroundColor(theme.primaryTextColor)

            // Message
            VStack(spacing: 16) {
                Text(String(localized: "A verification email has been sent to \\(email)"))
                    .font(.body)
                    .multilineTextAlignment(.center)

                Text("Please check your email and follow the instructions to verify your account before logging in.")
                    .font(.subheadline)
                    .foregroundColor(theme.secondaryTextColor)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 32)

            // Email Icon
            HStack {
                Image(systemName: "envelope.fill")
                    .foregroundColor(theme.primaryColor)
                Text(email)
                    .foregroundColor(theme.primaryTextColor)
            }
            .padding()
            .background(theme.secondarySurfaceColor)
            .cornerRadius(12)

            Spacer()

            // Back to Login Button
            Button(action: onBackToLogin) {
                Text("Back to Login")
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(theme.primaryColor)
                    .foregroundColor(.white)
                    .cornerRadius(12)
            }
            .padding(.horizontal, 32)

            Spacer()
        }
        .background(theme.surfaceColor)
    }
}

#Preview {
    RegistrationSuccessView(
        email: "test@example.com",
        onBackToLogin: {}
    )
    .environment(ThemeManager())
}
