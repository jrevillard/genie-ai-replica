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

    // Availability checking
    @State private var usernameError: String?
    @State private var emailError: String?
    @State private var isCheckingUsername = false
    @State private var isCheckingEmail = false
    @State private var usernameCheckTask: Task<Void, Never>?
    @State private var emailCheckTask: Task<Void, Never>?

    // Password strength
    @State private var passwordStrength = PasswordStrength(score: 0, isValid: false)

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
                            .onChange(of: username) { _, newValue in
                                checkAvailability(type: "username", value: newValue)
                            }

                        if let error = usernameError {
                            Text(error)
                                .font(.caption)
                                .foregroundColor(theme.errorColor)
                        }
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
                            .onChange(of: email) { _, newValue in
                                checkAvailability(type: "email", value: newValue)
                            }

                        if let error = emailError {
                            Text(error)
                                .font(.caption)
                                .foregroundColor(theme.errorColor)
                        }
                    }

                    // Password
                    VStack(alignment: .leading, spacing: 8) {
                        Text(i18n.translate("register.password"))
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)

                        SecureField(i18n.translate("register.passwordPlaceholder"), text: $password)
                            .textFieldStyle(GenieTextFieldStyle())
                            .onChange(of: password) { _, newValue in
                                passwordStrength = PasswordValidator.validateStrength(newValue)
                            }

                        // Password Strength Meter
                        if !password.isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                ProgressView(value: passwordStrength.normalizedScore)
                                    .tint(passwordStrength.color)

                                Text(passwordStrengthLabel)
                                    .font(.caption)
                                    .foregroundColor(passwordStrength.color)
                            }
                        }

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

                // Language Selector
                LanguageSelectorCompact()
                    .padding(.horizontal)

                Spacer()
            }
        }
        .background(theme.surfaceColor)
    }

    private var passwordStrengthLabel: String {
        switch passwordStrength.score {
        case 0: return i18n.translate("passwordResetConfirm.strengthLabels.veryWeak")
        case 1: return i18n.translate("passwordResetConfirm.strengthLabels.weak")
        case 2: return i18n.translate("passwordResetConfirm.strengthLabels.fair")
        case 3: return i18n.translate("passwordResetConfirm.strengthLabels.good")
        default: return i18n.translate("passwordResetConfirm.strengthLabels.strong")
        }
    }

    private var canRegister: Bool {
        !username.isEmpty &&
        !email.isEmpty &&
        !password.isEmpty &&
        !confirmPassword.isEmpty &&
        acceptTerms &&
        password == confirmPassword &&
        usernameError == nil &&
        emailError == nil &&
        passwordStrength.isValid
    }

    // MARK: - Availability Checking

    private func checkAvailability(type: String, value: String) {
        if type == "username" {
            usernameCheckTask?.cancel()
            guard value.count >= 3 else {
                usernameError = nil
                return
            }
            isCheckingUsername = true
            usernameCheckTask = Task {
                try? await Task.sleep(nanoseconds: 500_000_000) // 500ms debounce
                guard !Task.isCancelled else { return }
                do {
                    let userService = UserService()
                    let available = try await userService.checkUsernameAvailability(value)
                    await MainActor.run {
                        isCheckingUsername = false
                        usernameError = available ? nil : i18n.translate("register.usernameExists")
                    }
                } catch {
                    await MainActor.run {
                        isCheckingUsername = false
                    }
                }
            }
        } else {
            emailCheckTask?.cancel()
            guard value.count >= 3, isValidEmail(value) else {
                emailError = nil
                return
            }
            isCheckingEmail = true
            emailCheckTask = Task {
                try? await Task.sleep(nanoseconds: 500_000_000) // 500ms debounce
                guard !Task.isCancelled else { return }
                do {
                    let userService = UserService()
                    let available = try await userService.checkEmailAvailability(value)
                    await MainActor.run {
                        isCheckingEmail = false
                        emailError = available ? nil : i18n.translate("register.emailExists")
                    }
                } catch {
                    await MainActor.run {
                        isCheckingEmail = false
                    }
                }
            }
        }
    }

    private func performRegistration() {
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

        guard passwordStrength.isValid else {
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
