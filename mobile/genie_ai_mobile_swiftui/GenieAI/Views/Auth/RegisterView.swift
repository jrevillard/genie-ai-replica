// RegisterView.swift
// Registration screen for new users

import SwiftUI

struct RegisterView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    @State private var username = ""
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var acceptTerms = false
    @State private var showError = false
    @State private var errorMessage = ""
    @State private var isLoading = false
    @State private var showSuccess = false

    var onBackToLogin: () -> Void
    var onRegistrationSuccess: (String) -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                VStack(spacing: 16) {
                    Image(systemName: "person.badge.plus")
                        .font(.system(size: 50))
                        .foregroundStyle(theme.navbarGradient)

                    Text(i18n.translate("register.createAccount"))
                        .font(.title)
                        .fontWeight(.bold)
                        .foregroundColor(theme.primaryTextColor)
                }
                .padding(.top, 40)

                // Registration Form
                VStack(spacing: 16) {
                    // Username
                    VStack(alignment: .leading, spacing: 8) {
                        Text(i18n.translate("register.username"))
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)

                        TextField(i18n.translate("register.usernamePlaceholder"), text: $username)
                            .textFieldStyle(GenieTextFieldStyle())
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }

                    // Email
                    VStack(alignment: .leading, spacing: 8) {
                        Text(i18n.translate("register.email"))
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)

                        TextField(i18n.translate("register.emailPlaceholder"), text: $email)
                            .textFieldStyle(GenieTextFieldStyle())
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.emailAddress)
                    }

                    // Password
                    VStack(alignment: .leading, spacing: 8) {
                        Text(i18n.translate("register.password"))
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)

                        SecureField(i18n.translate("register.passwordPlaceholder"), text: $password)
                            .textFieldStyle(GenieTextFieldStyle())

                        Text(i18n.translate("register.passwordRequirements"))
                            .font(.caption)
                            .foregroundColor(theme.secondaryTextColor)
                    }

                    // Confirm Password
                    VStack(alignment: .leading, spacing: 8) {
                        Text(i18n.translate("register.confirmPassword"))
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)

                        SecureField(i18n.translate("register.confirmPasswordPlaceholder"), text: $confirmPassword)
                            .textFieldStyle(GenieTextFieldStyle())
                    }

                    // Terms Acceptance
                    HStack {
                        Toggle(isOn: $acceptTerms) {
                            HStack(spacing: 4) {
                                Text(i18n.translate("register.acceptTerms"))
                                Text(i18n.translate("register.termsOfService"))
                                    .foregroundColor(theme.primaryColor)
                            }
                            .font(.subheadline)
                        }
                        .toggleStyle(CheckboxToggleStyle())

                        Spacer()
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

                // Register Button
                Button(action: performRegistration) {
                    HStack {
                        if isLoading {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        }
                        Text(isLoading ? i18n.translate("register.processing") : i18n.translate("register.registerButton"))
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(canRegister ? theme.primaryColor : Color.gray)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .disabled(!canRegister || isLoading)
                .padding(.horizontal)

                // Back to Login
                HStack {
                    Text(i18n.translate("register.alreadyHaveAccount"))
                        .foregroundColor(theme.secondaryTextColor)

                    Button(action: onBackToLogin) {
                        Text(i18n.translate("register.loginNow"))
                            .fontWeight(.semibold)
                            .foregroundColor(theme.primaryColor)
                    }
                }
                .font(.subheadline)

                // Privacy Notice
                Text(i18n.translate("register.privacyNotice"))
                    .font(.caption)
                    .foregroundColor(theme.secondaryTextColor)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                Spacer()
            }
        }
        .background(theme.surfaceColor)
    }

    private var canRegister: Bool {
        !username.isEmpty &&
        !email.isEmpty &&
        !password.isEmpty &&
        !confirmPassword.isEmpty &&
        acceptTerms &&
        password == confirmPassword
    }

    private func performRegistration() {
        // Validation
        guard username.count >= 3 else {
            errorMessage = i18n.translate("register.usernameMinLength")
            showError = true
            return
        }

        guard isValidEmail(email) else {
            errorMessage = i18n.translate("register.invalidEmail")
            showError = true
            return
        }

        guard isValidPassword(password) else {
            errorMessage = i18n.translate("register.passwordRequirements")
            showError = true
            return
        }

        guard password == confirmPassword else {
            errorMessage = i18n.translate("register.passwordsDoNotMatch")
            showError = true
            return
        }

        guard acceptTerms else {
            errorMessage = i18n.translate("register.mustAcceptTerms")
            showError = true
            return
        }

        isLoading = true
        showError = false

        Task {
            do {
                try await authService.register(username: username, email: email, password: password)
                await MainActor.run {
                    isLoading = false
                    onRegistrationSuccess(email)
                }
            } catch {
                await MainActor.run {
                    isLoading = false
                    errorMessage = i18n.translate("register.registrationFailed")
                    showError = true
                }
            }
        }
    }

    private func isValidEmail(_ email: String) -> Bool {
        let emailRegex = "[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,64}"
        return NSPredicate(format: "SELF MATCHES %@", emailRegex).evaluate(with: email)
    }

    private func isValidPassword(_ password: String) -> Bool {
        // At least 8 characters, 1 uppercase, 1 number
        let passwordRegex = "^(?=.*[A-Z])(?=.*[0-9]).{8,}$"
        return NSPredicate(format: "SELF MATCHES %@", passwordRegex).evaluate(with: password)
    }
}

#Preview {
    RegisterView(
        onBackToLogin: {},
        onRegistrationSuccess: { _ in }
    )
    .environment(AuthService())
    .environment(ThemeManager())
    .environment(I18nService())
}
