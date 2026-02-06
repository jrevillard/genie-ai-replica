// RegisterView.swift
// Registration screen for new users

import SwiftUI

struct RegisterView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme

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

                    Text("Create New Account")
                        .font(.title)
                        .fontWeight(.bold)
                        .foregroundColor(theme.primaryTextColor)
                }
                .padding(.top, 40)

                // Registration Form
                VStack(spacing: 16) {
                    // Username
                    VStack(alignment: .leading, spacing: 8) {
                        Text("register.username")
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)

                        TextField("Enter a username", text: $username)
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
                        Text("Email")
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)

                        TextField("Enter your email", text: $email)
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
                        Text("Password")
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)

                        SecureField(String(localized: "Create a password"), text: $password)
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

                        Text("Password must be at least 8 characters with at least 1 number and 1 uppercase letter")
                            .font(.caption)
                            .foregroundColor(theme.secondaryTextColor)
                    }

                    // Confirm Password
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Confirm Password")
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)

                        SecureField(String(localized: "Confirm your password"), text: $confirmPassword)
                            .textFieldStyle(GenieTextFieldStyle())
                    }

                    // Terms Acceptance
                    HStack {
                        Toggle(isOn: $acceptTerms) {
                            HStack(spacing: 4) {
                                Text("I accept the")
                                Text("Terms of Service")
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
                        Text(isLoading ? String(localized: "Processing...") : String(localized: "register.registerButton"))
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(canRegister ? theme.primaryColor : Color.gray)
                    .foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: theme.radiusMD, style: .continuous))
                }
                .disabled(!canRegister || isLoading)
                .hapticOnTap(.medium, theme: theme)
                .padding(.horizontal)

                // Back to Login
                HStack {
                    Text("Already have an account?")
                        .foregroundColor(theme.secondaryTextColor)

                    Button(action: onBackToLogin) {
                        Text("Log in")
                            .fontWeight(.semibold)
                            .foregroundColor(theme.primaryColor)
                    }
                }
                .font(.subheadline)

                // Privacy Notice
                Text("By registering, you agree to our Terms of Service and Privacy Policy")
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
        .background(
            LinearGradient(
                colors: [theme.backgroundColor, theme.surfaceColor],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
        )
    }

    private var passwordStrengthLabel: String {
        switch passwordStrength.score {
        case 0: return String(localized: "Very Weak")
        case 1: return String(localized: "Weak")
        case 2: return String(localized: "Fair")
        case 3: return String(localized: "Good")
        default: return String(localized: "Strong")
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
                        usernameError = available ? nil : String(localized: "Username already exists")
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
                        emailError = available ? nil : String(localized: "Email already exists")
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
            errorMessage = String(localized: "Username must be at least 3 characters")
            showError = true
            return
        }

        guard isValidEmail(email) else {
            errorMessage = String(localized: "register.invalidEmail")
            showError = true
            return
        }

        guard passwordStrength.isValid else {
            errorMessage = String(localized: "Password must be at least 8 characters with at least 1 number and 1 uppercase letter")
            showError = true
            return
        }

        guard password == confirmPassword else {
            errorMessage = String(localized: "Passwords do not match")
            showError = true
            return
        }

        guard acceptTerms else {
            errorMessage = String(localized: "You must accept the Terms of Service")
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
                    errorMessage = String(localized: "Registration failed. Please try again.")
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
}
