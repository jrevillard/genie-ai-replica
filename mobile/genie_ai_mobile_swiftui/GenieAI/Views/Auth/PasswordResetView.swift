// PasswordResetView.swift
// Password reset request screen

import SwiftUI

struct PasswordResetView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme

    @State private var email = ""
    @State private var showError = false
    @State private var errorMessage = ""
    @State private var isLoading = false
    @State private var showSuccess = false

    var onBackToLogin: () -> Void
    var prefilledEmail: String? = nil

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                VStack(spacing: 16) {
                    Image(systemName: "key.fill")
                        .font(.system(size: 50))
                        .foregroundStyle(theme.navbarGradient)

                    Text("Reset Your Password")
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

                        Text("Password reset link has been sent to your email")
                            .font(.headline)
                            .multilineTextAlignment(.center)

                        Text("Please check your email for further instructions.")
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)
                            .multilineTextAlignment(.center)

                        Button(action: onBackToLogin) {
                            Text("Back to Login")
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
                            Text("passwordReset.emailLabel")
                                .font(.subheadline)
                                .foregroundColor(theme.secondaryTextColor)

                            TextField("Enter your email", text: $email)
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
                            Text(isLoading ? String(localized: "Sending...") : String(localized: "Send Reset Link"))
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
                        Text("Remember your password?")
                            .foregroundColor(theme.secondaryTextColor)

                        Button(action: onBackToLogin) {
                            Text("Back to Login")
                                .fontWeight(.semibold)
                                .foregroundColor(theme.primaryColor)
                        }
                    }
                    .font(.subheadline)

                    // Support Message
                    Text("Need help? Contact our support team")
                        .font(.caption)
                        .foregroundColor(theme.secondaryTextColor)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }

                Spacer()
            }
        }
        .background(theme.surfaceColor)
        .onAppear {
            if let prefilled = prefilledEmail, !prefilled.isEmpty {
                email = prefilled
            }
        }
    }

    private func performReset() {
        guard !email.isEmpty else {
            errorMessage = String(localized: "passwordReset.invalidEmail")
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
                    errorMessage = String(localized: "Unable to send password reset link. Please try again.")
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
}
