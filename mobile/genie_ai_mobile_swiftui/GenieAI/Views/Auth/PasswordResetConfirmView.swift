// PasswordResetConfirmView.swift
// Password reset confirmation with new password entry

import SwiftUI

struct PasswordResetConfirmView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme

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

                    Text("Create New Password")
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

                        Text("Your password has been successfully reset")
                            .font(.headline)
                            .multilineTextAlignment(.center)

                        Button(action: onBackToLogin) {
                            Text("Back to Login")
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
                                Text("Reset Token")
                                    .font(.subheadline)
                                    .foregroundColor(theme.secondaryTextColor)

                                TextField("Enter reset token", text: $token)
                                    .textFieldStyle(GenieTextFieldStyle())
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                            }
                        }

                        if tokenValidated {
                            // New Password
                            VStack(alignment: .leading, spacing: 8) {
                                Text("New Password")
                                    .font(.subheadline)
                                    .foregroundColor(theme.secondaryTextColor)

                                SecureField(String(localized: "Create a new password"), text: $newPassword)
                                    .textFieldStyle(GenieTextFieldStyle())

                                Text("Password must be at least 8 characters with at least 1 number, 1 uppercase letter, and 1 special character")
                                    .font(.caption)
                                    .foregroundColor(theme.secondaryTextColor)
                            }

                            // Confirm Password
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Confirm New Password")
                                    .font(.subheadline)
                                    .foregroundColor(theme.secondaryTextColor)

                                SecureField(String(localized: "Confirm your new password"), text: $confirmPassword)
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
                        Text("Remember your password?")
                            .foregroundColor(theme.secondaryTextColor)

                        Button(action: onBackToLogin) {
                            Text("Back to Login")
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
            return String(localized: "Resetting...")
        }
        return tokenValidated ? String(localized: "Reset Password") : String(localized: "Validate Token")
    }

    private var canProceed: Bool {
        if tokenValidated {
            return !newPassword.isEmpty && !confirmPassword.isEmpty && newPassword == confirmPassword
        }
        return !token.isEmpty
    }

    private func validateToken() {
        guard !token.isEmpty else {
            errorMessage = String(localized: "Please provide a reset token")
            showError = true
            return
        }

        // For now, just mark as validated - actual validation happens on reset
        tokenValidated = true
        showError = false
    }

    private func performReset() {
        guard newPassword == confirmPassword else {
            errorMessage = String(localized: "Passwords do not match")
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
                    errorMessage = String(localized: "Unable to reset password. Please try again.")
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
}
