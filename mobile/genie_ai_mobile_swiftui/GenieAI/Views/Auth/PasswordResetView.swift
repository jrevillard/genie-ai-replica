// PasswordResetView.swift
// Password reset request screen

import SwiftUI

struct PasswordResetView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    @State private var email = ""
    @State private var showError = false
    @State private var errorMessage = ""
    @State private var isLoading = false
    @State private var showSuccess = false

    var onBackToLogin: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                VStack(spacing: 16) {
                    Image(systemName: "key.fill")
                        .font(.system(size: 50))
                        .foregroundStyle(theme.navbarGradient)

                    Text(i18n.translate("passwordReset.resetPassword"))
                        .font(.title)
                        .fontWeight(.bold)
                        .foregroundColor(theme.primaryTextColor)
                }
                .padding(.top, 60)

                if showSuccess {
                    // Success Message
                    VStack(spacing: 16) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 60))
                            .foregroundColor(theme.successColor)

                        Text(i18n.translate("passwordReset.resetRequestSuccess"))
                            .font(.headline)
                            .multilineTextAlignment(.center)

                        Text(i18n.translate("passwordReset.checkEmail"))
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)
                            .multilineTextAlignment(.center)

                        Button(action: onBackToLogin) {
                            Text(i18n.translate("passwordReset.backToLogin"))
                                .fontWeight(.semibold)
                                .foregroundColor(theme.primaryColor)
                        }
                        .padding(.top)
                    }
                    .padding(.horizontal)
                } else {
                    // Reset Form
                    VStack(spacing: 16) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(i18n.translate("passwordReset.emailLabel"))
                                .font(.subheadline)
                                .foregroundColor(theme.secondaryTextColor)

                            TextField(i18n.translate("passwordReset.emailPlaceholder"), text: $email)
                                .textFieldStyle(GenieTextFieldStyle())
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .keyboardType(.emailAddress)
                        }
                    }
                    .padding(.horizontal)

                    // Error Message
                    if showError {
                        Text(errorMessage)
                            .font(.subheadline)
                            .foregroundColor(theme.errorColor)
                            .padding(.horizontal)
                    }

                    // Reset Button
                    Button(action: performReset) {
                        HStack {
                            if isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            }
                            Text(isLoading ? i18n.translate("passwordReset.processing") : i18n.translate("passwordReset.resetButton"))
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(email.isEmpty ? Color.gray : theme.primaryColor)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(email.isEmpty || isLoading)
                    .padding(.horizontal)

                    // Back to Login
                    HStack {
                        Text(i18n.translate("passwordReset.rememberPassword"))
                            .foregroundColor(theme.secondaryTextColor)

                        Button(action: onBackToLogin) {
                            Text(i18n.translate("passwordReset.backToLogin"))
                                .fontWeight(.semibold)
                                .foregroundColor(theme.primaryColor)
                        }
                    }
                    .font(.subheadline)

                    // Support Message
                    Text(i18n.translate("passwordReset.supportMessage"))
                        .font(.caption)
                        .foregroundColor(theme.secondaryTextColor)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }

                Spacer()
            }
        }
        .background(theme.surfaceColor)
    }

    private func performReset() {
        guard !email.isEmpty else {
            errorMessage = i18n.translate("passwordReset.invalidEmail")
            showError = true
            return
        }

        isLoading = true
        showError = false

        Task {
            do {
                try await authService.initiatePasswordReset(email: email)
                await MainActor.run {
                    isLoading = false
                    showSuccess = true
                }
            } catch {
                await MainActor.run {
                    isLoading = false
                    errorMessage = i18n.translate("passwordReset.resetRequestFailed")
                    showError = true
                }
            }
        }
    }
}

#Preview {
    PasswordResetView(onBackToLogin: {})
        .environment(AuthService())
        .environment(ThemeManager())
        .environment(I18nService())
}
