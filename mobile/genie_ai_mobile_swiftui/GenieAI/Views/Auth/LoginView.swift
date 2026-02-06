// LoginView.swift
// Login screen for user authentication

import SwiftUI

struct LoginView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(AppLocaleService.self) private var appLocale

    @State private var username = ""
    @State private var password = ""
    @State private var rememberMe = false
    @State private var showError = false
    @State private var errorMessage = ""
    @State private var isLoading = false

    var onRegisterTapped: () -> Void
    var onForgotPasswordTapped: () -> Void
    var onLoginSuccess: () -> Void

    @State private var logoAppeared = false

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Logo and Title
                VStack(spacing: 16) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 60))
                        .foregroundStyle(theme.navbarGradient)
                        .scaleEffect(logoAppeared ? 1.0 : 0.5)
                        .opacity(logoAppeared ? 1.0 : 0)

                    Text("Genie AI")
                        .font(.largeTitle)
                        .fontWeight(.bold)
                        .foregroundColor(theme.primaryTextColor)
                        .opacity(logoAppeared ? 1.0 : 0)
                }
                .padding(.top, 40)

                // Login Form — wrapped in glass card
                VStack(spacing: 16) {
                    // Username Field
                    VStack(alignment: .leading, spacing: 8) {
                        Text("login.username")
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)

                        TextField("", text: $username)
                            .textFieldStyle(GenieTextFieldStyle())
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }

                    // Password Field
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Password")
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)

                        SecureField("", text: $password)
                            .textFieldStyle(GenieTextFieldStyle())
                    }

                    // Remember Me & Forgot Password
                    HStack {
                        Toggle(isOn: $rememberMe) {
                            Text("Remember me")
                                .font(.subheadline)
                        }
                        .toggleStyle(CheckboxToggleStyle())

                        Spacer()

                        Button(action: onForgotPasswordTapped) {
                            Text("Forgot password?")
                                .font(.subheadline)
                                .foregroundColor(theme.primaryColor)
                        }
                    }

                    // Error Message
                    if showError {
                        Text(errorMessage)
                            .font(.subheadline)
                            .foregroundColor(theme.errorColor)
                    }

                    // Login Button
                    Button(action: performLogin) {
                        HStack {
                            if isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            }
                            Text(isLoading ? String(localized: "Logging in...") : String(localized: "Login"))
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(theme.primaryColor)
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: theme.radiusMD, style: .continuous))
                    }
                    .disabled(isLoading || username.isEmpty || password.isEmpty)
                    .hapticOnTap(.medium, theme: theme)
                }
                .padding(theme.spacingXL)
                .glassCardElevated(theme: theme)
                .padding(.horizontal)

                // Social Login Buttons
                VStack(spacing: 12) {
                    Button(action: { /* Social login not yet implemented */ }) {
                        HStack {
                            Image(systemName: "g.circle.fill")
                                .font(.title3)
                            Text("Continue with Google")
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(theme.primaryColor.opacity(0.9))
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: theme.radiusMD, style: .continuous))
                    }

                    Button(action: { /* Social login not yet implemented */ }) {
                        HStack {
                            Image(systemName: "f.circle.fill")
                                .font(.title3)
                            Text("Continue with Facebook")
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(theme.facebookBlue)
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: theme.radiusMD, style: .continuous))
                    }
                }
                .padding(.horizontal)

                // Register Link
                HStack {
                    Text("Don't have an account?")
                        .foregroundColor(theme.secondaryTextColor)

                    Button(action: onRegisterTapped) {
                        Text("Register now")
                            .fontWeight(.semibold)
                            .foregroundColor(theme.primaryColor)
                    }
                }
                .font(.subheadline)

                // Terms
                Text("By logging in, you agree to our Terms of Service and Privacy Policy")
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
        .onAppear {
            loadSavedCredentials()
            withAnimation(theme.animationBounce) {
                logoAppeared = true
            }
        }
    }

    private func loadSavedCredentials() {
        let defaults = UserDefaults.standard
        if let savedUsername = defaults.string(forKey: "savedLoginName"),
           let savedPassword = defaults.string(forKey: "savedPassword"),
           !savedUsername.isEmpty, !savedPassword.isEmpty {
            username = savedUsername
            password = savedPassword
            rememberMe = true
        }
    }

    private func handleRememberMe() {
        let defaults = UserDefaults.standard
        if rememberMe {
            defaults.set(username, forKey: "savedLoginName")
            defaults.set(password, forKey: "savedPassword")
        } else {
            defaults.removeObject(forKey: "savedLoginName")
            defaults.removeObject(forKey: "savedPassword")
        }
    }

    private func performLogin() {
        guard !username.isEmpty, !password.isEmpty else {
            errorMessage = String(localized: "Username and password are required")
            showError = true
            return
        }

        isLoading = true
        showError = false

        Task {
            do {
                try await authService.login(loginName: username, password: password)
                await MainActor.run {
                    isLoading = false
                    handleRememberMe()
                    onLoginSuccess()
                }
            } catch {
                await MainActor.run {
                    isLoading = false
                    errorMessage = String(localized: "Login failed. Please check your credentials.")
                    showError = true
                }
            }
        }
    }
}

// MARK: - Compact Language Selector (opens iOS per-app language setting)

struct LanguageSelectorCompact: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(AppLocaleService.self) private var appLocale

    var body: some View {
        Button {
            AppLocaleService.openLanguageSettings()
        } label: {
            HStack {
                Image(systemName: "globe")
                Text(appLocale.currentLanguageName)
                Image(systemName: "arrow.up.forward.square")
                    .font(.caption)
            }
            .font(.subheadline)
            .foregroundColor(theme.secondaryTextColor)
            .padding(.vertical, 8)
        }
    }
}

// MARK: - Custom Text Field Style

struct GenieTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .padding()
            .background(Color(.secondarySystemBackground).opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color(.separator).opacity(0.3), lineWidth: 1)
            )
    }
}

// MARK: - Checkbox Toggle Style

struct CheckboxToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack {
            Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                .foregroundColor(configuration.isOn ? .blue : .gray)
                .onTapGesture {
                    configuration.isOn.toggle()
                }

            configuration.label
        }
    }
}

#Preview {
    LoginView(
        onRegisterTapped: {},
        onForgotPasswordTapped: {},
        onLoginSuccess: {}
    )
    .environment(AuthService())
    .environment(ThemeManager())
    .environment(AppLocaleService.shared)
}
