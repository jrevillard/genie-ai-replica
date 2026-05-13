// LoginView.swift
// Single "Sign in" screen that delegates to Keycloak's hosted UI via
// ASWebAuthenticationSession. Registration and password reset are handled
// inside Keycloak (links surface on its login page), so the previous
// inline email/password form, Register/Forgot Password navigation, and
// "remember me" UserDefaults storage are intentionally removed.

import SwiftUI

struct LoginView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(AppLocaleService.self) private var appLocale

    @State private var showError = false
    @State private var errorMessage = ""
    @State private var isLoading = false
    @State private var logoAppeared = false

    // Closures kept so the AppRoute navigation continues to compile, but
    // they are no longer surfaced from this view.
    var onRegisterTapped: () -> Void = {}
    var onForgotPasswordTapped: () -> Void = {}
    var onLoginSuccess: () -> Void = {}

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            VStack(spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.system(size: 56))
                    .foregroundStyle(theme.navbarGradient)
                    .scaleEffect(logoAppeared ? 1.0 : 0.5)
                    .opacity(logoAppeared ? 1.0 : 0)

                Text("Genie AI")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                    .foregroundColor(theme.primaryTextColor)
                    .opacity(logoAppeared ? 1.0 : 0)

                Text("Sign in to access your conversations and the offline document library.")
                    .font(.subheadline)
                    .foregroundColor(theme.secondaryTextColor)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, theme.spacingLG)
            }

            Spacer().frame(maxHeight: 32)

            VStack(spacing: theme.spacingMD) {
                Button(action: performSignIn) {
                    HStack {
                        if isLoading {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        } else {
                            Image(systemName: "person.crop.circle.badge.checkmark")
                        }
                        Text(isLoading ? "Signing in…" : "Sign in")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(theme.primaryColor)
                    .foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: theme.radiusMD, style: .continuous))
                }
                .disabled(isLoading)
                .hapticOnTap(.medium, theme: theme)

                if showError {
                    Text(errorMessage)
                        .font(.subheadline)
                        .foregroundColor(theme.errorColor)
                        .multilineTextAlignment(.center)
                }

                LanguageSelectorCompact()
            }
            .padding(theme.spacingLG)
            .glassCardElevated(theme: theme)
            .padding(.horizontal)

            Spacer().frame(maxHeight: 20)

            Text("By signing in, you agree to the Terms of Service and Privacy Policy.")
                .font(.caption2)
                .foregroundColor(theme.secondaryTextColor)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Spacer(minLength: 0)
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
            withAnimation(theme.animationBounce) {
                logoAppeared = true
            }
        }
    }

    private func performSignIn() {
        isLoading = true
        showError = false

        Task {
            do {
                try await authService.signIn()
                await MainActor.run {
                    isLoading = false
                    onLoginSuccess()
                }
            } catch {
                await MainActor.run {
                    isLoading = false
                    if case AuthError.cancelled = error {
                        // User cancelled — don't show an error, just reset.
                        return
                    }
                    errorMessage = error.localizedDescription
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

// MARK: - Shared text-field style
//
// Used by RegisterView, PasswordResetView, PasswordResetConfirmView. The
// inline password form was removed from LoginView itself when sign-in
// moved to Keycloak's hosted UI, but the style stays here as those views
// still ship in the project (Keycloak handles the actual flows, but the
// files remain so the project compiles).

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

// SwiftUI ships a `CheckboxToggleStyle` only on macOS. Our custom version
// is iOS-compatible and still referenced by RegisterView's Terms checkbox.
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
    LoginView()
        .environment(AuthService())
        .environment(ThemeManager())
        .environment(AppLocaleService.shared)
}
