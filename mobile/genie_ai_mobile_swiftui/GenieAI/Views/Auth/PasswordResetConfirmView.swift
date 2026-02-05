// PasswordResetConfirmView.swift
// Password reset confirmation with new password entry

import SwiftUI

struct PasswordResetConfirmView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    @State private var token = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var showError = false
    @State private var errorMessage = ""
    @State private var isLoading = false
    @State private var showSuccess = false
    @State private var tokenValidated = false

    var resetToken: String?
    var onBackToLogin: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                VStack(spacing: 16) {
                    Image(systemName: "lock.rotation")
                        .font(.system(size: 50))
                        .foregroundStyle(theme.navbarGradient)

                    Text(i18n.translate("passwordResetConfirm.resetPassword"))
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

                        Text(i18n.translate("passwordResetConfirm.resetSuccess"))
                            .font(.headline)
                            .multilineTextAlignment(.center)

                        Button(action: onBackToLogin) {
                            Text(i18n.translate("passwordResetConfirm.backToLogin"))
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(theme.primaryColor)
                                .foregroundColor(.white)
                                .cornerRadius(12)
                        }
                        .padding(.horizontal)
                    }
                    .padding(.horizontal)
                } else {
                    // Reset Form
                    VStack(spacing: 16) {
                        if !tokenValidated {
                            // Token Entry
                            VStack(alignment: .leading, spacing: 8) {
                                Text(i18n.translate("passwordResetConfirm.tokenLabel"))
                                    .font(.subheadline)
                                    .foregroundColor(theme.secondaryTextColor)

                                TextField(i18n.translate("passwordResetConfirm.tokenPlaceholder"), text: $token)
                                    .textFieldStyle(GenieTextFieldStyle())
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                            }
                        }

                        if tokenValidated {
                            // New Password
                            VStack(alignment: .leading, spacing: 8) {
                                Text(i18n.translate("passwordResetConfirm.newPasswordLabel"))
                                    .font(.subheadline)
                                    .foregroundColor(theme.secondaryTextColor)

                                SecureField(i18n.translate("passwordResetConfirm.newPasswordPlaceholder"), text: $newPassword)
                                    .textFieldStyle(GenieTextFieldStyle())

                                Text(i18n.translate("passwordResetConfirm.passwordRequirements"))
                                    .font(.caption)
                                    .foregroundColor(theme.secondaryTextColor)
                            }

                            // Confirm Password
                            VStack(alignment: .leading, spacing: 8) {
                                Text(i18n.translate("passwordResetConfirm.confirmNewPasswordLabel"))
                                    .font(.subheadline)
                                    .foregroundColor(theme.secondaryTextColor)

                                SecureField(i18n.translate("passwordResetConfirm.confirmNewPasswordPlaceholder"), text: $confirmPassword)
                                    .textFieldStyle(GenieTextFieldStyle())
                            }
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

                    // Action Button
                    Button(action: tokenValidated ? performReset : validateToken) {
                        HStack {
                            if isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            }
                            Text(buttonText)
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(canProceed ? theme.primaryColor : Color.gray)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(!canProceed || isLoading)
                    .padding(.horizontal)

                    // Back to Login
                    HStack {
                        Text(i18n.translate("passwordResetConfirm.rememberedPassword"))
                            .foregroundColor(theme.secondaryTextColor)

                        Button(action: onBackToLogin) {
                            Text(i18n.translate("passwordResetConfirm.backToLogin"))
                                .fontWeight(.semibold)
                                .foregroundColor(theme.primaryColor)
                        }
                    }
                    .font(.subheadline)
                }

                Spacer()
            }
        }
        .background(theme.surfaceColor)
        .onAppear {
            if let resetToken = resetToken, !resetToken.isEmpty {
                token = resetToken
                tokenValidated = true
            }
        }
    }

    private var buttonText: String {
        if isLoading {
            return i18n.translate("passwordResetConfirm.processing")
        }
        return tokenValidated ? i18n.translate("passwordResetConfirm.resetButton") : i18n.translate("passwordResetConfirm.validateButton")
    }

    private var canProceed: Bool {
        if tokenValidated {
            return !newPassword.isEmpty && !confirmPassword.isEmpty && newPassword == confirmPassword
        }
        return !token.isEmpty
    }

    private func validateToken() {
        guard !token.isEmpty else {
            errorMessage = i18n.translate("passwordResetConfirm.noTokenProvided")
            showError = true
            return
        }

        // For now, just mark as validated - actual validation happens on reset
        tokenValidated = true
        showError = false
    }

    private func performReset() {
        guard newPassword == confirmPassword else {
            errorMessage = i18n.translate("passwordResetConfirm.passwordsDoNotMatch")
            showError = true
            return
        }

        isLoading = true
        showError = false

        Task {
            do {
                try await authService.confirmPasswordReset(token: token, newPassword: newPassword)
                await MainActor.run {
                    isLoading = false
                    showSuccess = true
                }
            } catch {
                await MainActor.run {
                    isLoading = false
                    errorMessage = i18n.translate("passwordResetConfirm.resetFailed")
                    showError = true
                }
            }
        }
    }
}

#Preview {
    PasswordResetConfirmView(onBackToLogin: {})
        .environment(AuthService())
        .environment(ThemeManager())
        .environment(I18nService())
}
