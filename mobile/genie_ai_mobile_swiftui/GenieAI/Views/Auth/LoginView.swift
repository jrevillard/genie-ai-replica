// LoginView.swift
// Login screen for user authentication

import SwiftUI

struct LoginView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    @State private var username = ""
    @State private var password = ""
    @State private var rememberMe = false
    @State private var showError = false
    @State private var errorMessage = ""
    @State private var isLoading = false

    var onRegisterTapped: () -> Void
    var onForgotPasswordTapped: () -> Void
    var onLoginSuccess: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Logo and Title
                VStack(spacing: 16) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 60))
                        .foregroundStyle(theme.navbarGradient)

                    Text(i18n.translate("login.appTitle"))
                        .font(.largeTitle)
                        .fontWeight(.bold)
                        .foregroundColor(theme.primaryTextColor)
                }
                .padding(.top, 40)

                // Login Form
                VStack(spacing: 16) {
                    // Username Field
                    VStack(alignment: .leading, spacing: 8) {
                        Text(i18n.translate("login.username"))
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)

                        TextField("", text: $username)
                            .textFieldStyle(GenieTextFieldStyle())
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }

                    // Password Field
                    VStack(alignment: .leading, spacing: 8) {
                        Text(i18n.translate("login.password"))
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)

                        SecureField("", text: $password)
                            .textFieldStyle(GenieTextFieldStyle())
                    }

                    // Remember Me & Forgot Password
                    HStack {
                        Toggle(isOn: $rememberMe) {
                            Text(i18n.translate("login.rememberMe"))
                                .font(.subheadline)
                        }
                        .toggleStyle(CheckboxToggleStyle())

                        Spacer()

                        Button(action: onForgotPasswordTapped) {
                            Text(i18n.translate("login.forgotPassword"))
                                .font(.subheadline)
                                .foregroundColor(theme.primaryColor)
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

                // Login Button
                Button(action: performLogin) {
                    HStack {
                        if isLoading {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        }
                        Text(isLoading ? i18n.translate("login.loggingIn") : i18n.translate("login.loginButton"))
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(theme.primaryColor)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .disabled(isLoading || username.isEmpty || password.isEmpty)
                .padding(.horizontal)

                // Register Link
                HStack {
                    Text(i18n.translate("login.noAccount"))
                        .foregroundColor(theme.secondaryTextColor)

                    Button(action: onRegisterTapped) {
                        Text(i18n.translate("login.registerNow"))
                            .fontWeight(.semibold)
                            .foregroundColor(theme.primaryColor)
                    }
                }
                .font(.subheadline)

                // Terms
                Text(i18n.translate("login.termsAndPolicy"))
                    .font(.caption)
                    .foregroundColor(theme.secondaryTextColor)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                Spacer()
            }
        }
        .background(theme.surfaceColor)
    }

    private func performLogin() {
        guard !username.isEmpty, !password.isEmpty else {
            errorMessage = i18n.translate("login.fieldsRequired")
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
                    onLoginSuccess()
                }
            } catch {
                await MainActor.run {
                    isLoading = false
                    errorMessage = i18n.translate("login.loginError")
                    showError = true
                }
            }
        }
    }
}

// MARK: - Custom Text Field Style

struct GenieTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(10)
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
    .environment(I18nService())
}
