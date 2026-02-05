// SettingsView.swift
// Settings screen for theme, language, and account management

import SwiftUI

struct SettingsView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n
    @Environment(\.dismiss) private var dismiss

    @State private var showResetDataAlert = false
    @State private var showDeleteAccountSheet = false

    var body: some View {
        NavigationStack {
            List {
                // Display Section
                Section(header: Text(i18n.translate("settings.display"))) {
                    // Language
                    NavigationLink {
                        LanguageSelector()
                    } label: {
                        HStack {
                            Image(systemName: "globe")
                            Text(i18n.translate("settings.displayLanguage"))
                            Spacer()
                            Text(currentLanguageName)
                                .foregroundColor(theme.secondaryTextColor)
                        }
                    }

                    // Theme
                    Picker(selection: Binding(
                        get: { theme.currentTheme },
                        set: { theme.setTheme($0) }
                    )) {
                        ForEach(AppTheme.allCases, id: \.self) { appTheme in
                            Text(appTheme.displayName).tag(appTheme)
                        }
                    } label: {
                        HStack {
                            Image(systemName: "paintbrush")
                            Text(i18n.translate("settings.theme"))
                        }
                    }
                }

                // Account Section
                Section(header: Text(i18n.translate("settings.accountManagement"))) {
                    // Email
                    HStack {
                        Image(systemName: "envelope")
                        Text(i18n.translate("settings.emailAddress"))
                        Spacer()
                        Text(authService.currentUser?.email ?? "")
                            .foregroundColor(theme.secondaryTextColor)
                    }

                    // Change Password
                    Button {
                        // TODO: Implement password change
                    } label: {
                        HStack {
                            Image(systemName: "key")
                            Text(i18n.translate("settings.changePassword"))
                        }
                    }

                    // Reset Data
                    Button {
                        showResetDataAlert = true
                    } label: {
                        HStack {
                            Image(systemName: "arrow.counterclockwise")
                            Text(i18n.translate("settings.resetUserData"))
                        }
                    }

                    // Delete Account
                    Button(role: .destructive) {
                        showDeleteAccountSheet = true
                    } label: {
                        HStack {
                            Image(systemName: "trash")
                            Text(i18n.translate("settings.deleteAccount"))
                        }
                    }
                }

                // About Section
                Section {
                    NavigationLink {
                        AboutView()
                    } label: {
                        HStack {
                            Image(systemName: "info.circle")
                            Text(i18n.translate("about.title"))
                        }
                    }
                }
            }
            .navigationTitle(i18n.translate("settings.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(i18n.translate("settings.close")) {
                        dismiss()
                    }
                }
            }
            .alert(i18n.translate("settings.resetUserDataTitle"), isPresented: $showResetDataAlert) {
                Button(i18n.translate("common.cancel"), role: .cancel) {}
                Button(i18n.translate("settings.reset"), role: .destructive) {
                    // TODO: Implement reset
                }
            } message: {
                Text(i18n.translate("settings.confirmResetUserData"))
            }
            .sheet(isPresented: $showDeleteAccountSheet) {
                DeleteAccountSheet(onDismiss: { showDeleteAccountSheet = false })
            }
        }
    }

    private var currentLanguageName: String {
        i18n.supportedLanguages.first { $0.code == i18n.currentLocale }?.name ?? "English"
    }
}

// MARK: - Delete Account Sheet

struct DeleteAccountSheet: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    @State private var password = ""
    @State private var reason = ""
    @State private var isDeleting = false
    @State private var showError = false

    var onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                // Warning
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.largeTitle)
                        .foregroundColor(theme.warningColor)

                    Text(i18n.translate("settings.confirmAccountDeletion"))
                        .font(.headline)

                    Text(i18n.translate("settings.accountDeletionWarning"))
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)
                        .multilineTextAlignment(.center)
                }
                .padding()

                // Reason
                VStack(alignment: .leading, spacing: 8) {
                    Text(i18n.translate("settings.deletionReason"))
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)

                    TextField(i18n.translate("settings.deletionReasonPlaceholder"), text: $reason, axis: .vertical)
                        .lineLimit(3)
                        .textFieldStyle(GenieTextFieldStyle())
                }
                .padding(.horizontal)

                // Password
                VStack(alignment: .leading, spacing: 8) {
                    Text(i18n.translate("settings.enterPasswordConfirm"))
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)

                    SecureField(i18n.translate("settings.currentPasswordPlaceholder"), text: $password)
                        .textFieldStyle(GenieTextFieldStyle())
                }
                .padding(.horizontal)

                Spacer()

                // Delete Button
                Button(role: .destructive, action: deleteAccount) {
                    HStack {
                        if isDeleting {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        }
                        Text(isDeleting ? i18n.translate("settings.deleting") : i18n.translate("settings.permanentlyDeleteAccount"))
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.red)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .disabled(password.isEmpty || isDeleting)
                .padding(.horizontal)
                .padding(.bottom)
            }
            .navigationTitle(i18n.translate("settings.deleteAccountTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(i18n.translate("common.cancel"), action: onDismiss)
                }
            }
        }
    }

    private func deleteAccount() {
        isDeleting = true

        Task {
            do {
                let userService = UserService()
                try await userService.deleteAccount(password: password, reason: reason)
                await authService.logout()
                await MainActor.run {
                    onDismiss()
                }
            } catch {
                await MainActor.run {
                    isDeleting = false
                    showError = true
                }
            }
        }
    }
}

#Preview {
    SettingsView()
        .environment(AuthService())
        .environment(ThemeManager())
        .environment(I18nService())
}
