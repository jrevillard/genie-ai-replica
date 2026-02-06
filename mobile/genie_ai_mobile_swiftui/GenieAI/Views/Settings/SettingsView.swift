// SettingsView.swift
// Settings screen for theme, language, account management, and user preferences

import SwiftUI

struct SettingsView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n
    @Environment(ConnectivityService.self) private var connectivity
    @Environment(\.dismiss) private var dismiss

    @State private var showResetDataAlert = false
    @State private var showDeleteAccountSheet = false
    @State private var showPasswordReset = false
    @State private var showEmailEditSheet = false

    // Local settings state
    @State private var fontSize: Double = 50.0
    @State private var emailUpdates = false
    @State private var soundNotifications = true
    @State private var isSaving = false
    @State private var isResettingData = false

    var body: some View {
        NavigationStack {
            List {
                // User Identity Section
                userIdentitySection

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

                    // Font Size Slider
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Image(systemName: "textformat.size")
                            Text(i18n.translate("settings.fontSize"))
                            Spacer()
                            Text("\(Int(fontSize))%")
                                .foregroundColor(theme.secondaryTextColor)
                        }

                        Slider(value: $fontSize, in: 30...100, step: 5)
                            .tint(theme.primaryColor)
                    }
                }

                // Notifications Section
                Section(header: Text(i18n.translate("settings.notifications"))) {
                    Toggle(isOn: $emailUpdates) {
                        HStack {
                            Image(systemName: "envelope")
                            Text(i18n.translate("settings.emailUpdates"))
                        }
                    }
                    .disabled(!connectivity.isOnline)

                    Toggle(isOn: $soundNotifications) {
                        HStack {
                            Image(systemName: "speaker.wave.2")
                            Text(i18n.translate("settings.soundNotifications"))
                        }
                    }
                    .disabled(!connectivity.isOnline)
                }

                // Account Section
                Section(header: Text(i18n.translate("settings.accountManagement"))) {
                    // Email with Edit
                    HStack {
                        Image(systemName: "envelope")
                        Text(i18n.translate("settings.emailAddress"))
                        Spacer()
                        Text(authService.currentUser?.email ?? "")
                            .foregroundColor(theme.secondaryTextColor)
                            .lineLimit(1)

                        Button {
                            showEmailEditSheet = true
                        } label: {
                            Image(systemName: "pencil")
                                .foregroundColor(connectivity.isOnline ? theme.primaryColor : .gray)
                        }
                        .disabled(!connectivity.isOnline)
                    }

                    // Change Password
                    Button {
                        showPasswordReset = true
                    } label: {
                        HStack {
                            Image(systemName: "key")
                            Text(i18n.translate("settings.changePassword"))
                        }
                    }
                    .disabled(!connectivity.isOnline)

                    // Reset Data
                    Button {
                        showResetDataAlert = true
                    } label: {
                        HStack {
                            Image(systemName: "arrow.counterclockwise")
                            Text(i18n.translate("settings.resetUserData"))
                        }
                    }
                    .disabled(!connectivity.isOnline)

                    // Delete Account
                    Button(role: .destructive) {
                        showDeleteAccountSheet = true
                    } label: {
                        HStack {
                            Image(systemName: "trash")
                            Text(i18n.translate("settings.deleteAccount"))
                        }
                    }
                    .disabled(!connectivity.isOnline)
                }

                // Save Button
                Section {
                    Button(action: saveSettings) {
                        HStack {
                            Spacer()
                            if isSaving {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle())
                            }
                            Text(i18n.translate("settings.saveSettings"))
                                .fontWeight(.semibold)
                            Spacer()
                        }
                    }
                    .disabled(isSaving)
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
            .onAppear {
                fontSize = theme.fontSize
            }
            .alert(i18n.translate("settings.resetUserDataTitle"), isPresented: $showResetDataAlert) {
                Button(i18n.translate("common.cancel"), role: .cancel) {}
                Button(i18n.translate("settings.reset"), role: .destructive) {
                    resetUserData()
                }
            } message: {
                Text(i18n.translate("settings.confirmResetUserData"))
            }
            .sheet(isPresented: $showDeleteAccountSheet) {
                DeleteAccountSheet(onDismiss: { showDeleteAccountSheet = false })
            }
            .sheet(isPresented: $showPasswordReset) {
                PasswordResetOverlay(
                    prefilledEmail: authService.currentUser?.email ?? "",
                    onDismiss: { showPasswordReset = false }
                )
            }
            .sheet(isPresented: $showEmailEditSheet) {
                EmailEditSheet(
                    currentEmail: authService.currentUser?.email ?? "",
                    onDismiss: { showEmailEditSheet = false }
                )
            }
        }
    }

    // MARK: - User Identity Section

    @ViewBuilder
    private var userIdentitySection: some View {
        Section {
            HStack(spacing: 16) {
                // Avatar with initials
                ZStack {
                    Circle()
                        .fill(theme.primaryColor)
                        .frame(width: 68, height: 68)

                    Text(userInitials)
                        .font(.title2)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(authService.currentUser?.displayName ?? authService.currentUser?.loginName ?? "")
                        .font(.headline)
                        .foregroundColor(theme.primaryTextColor)

                    Text(authService.currentUser?.email ?? "")
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)

                    Text(authService.currentUser?.role?.capitalized ?? i18n.translate("settings.standardAccount"))
                        .font(.caption)
                        .foregroundColor(theme.primaryColor)
                }

                Spacer()
            }
            .padding(.vertical, 4)
        }
    }

    private var userInitials: String {
        let name = authService.currentUser?.displayName ?? authService.currentUser?.loginName ?? ""
        let parts = name.split(separator: " ")
        if parts.count >= 2 {
            return "\(parts[0].prefix(1))\(parts[1].prefix(1))".uppercased()
        } else if let first = parts.first {
            return String(first.prefix(1)).uppercased()
        }
        return "?"
    }

    private var currentLanguageName: String {
        i18n.supportedLanguages.first { $0.code == i18n.currentLocale }?.name ?? "English"
    }

    // MARK: - Actions

    private func saveSettings() {
        guard let userId = authService.currentUser?.id else { return }
        isSaving = true

        // Always apply locally
        theme.setFontSize(fontSize)

        if connectivity.isOnline {
            Task {
                do {
                    let userService = UserService()
                    try await userService.updateAccountSettings(userId: userId, settings: [
                        "fontSize": Int(fontSize),
                        "emailUpdates": emailUpdates,
                        "soundNotifications": soundNotifications,
                        "theme": theme.currentTheme.rawValue,
                        "language": i18n.currentLocale
                    ])
                    await MainActor.run {
                        isSaving = false
                    }
                } catch {
                    await MainActor.run {
                        isSaving = false
                    }
                }
            }
        } else {
            isSaving = false
        }
    }

    private func resetUserData() {
        guard let userId = authService.currentUser?.id else { return }
        isResettingData = true

        Task {
            do {
                let userService = UserService()
                try await userService.resetUserData(userId: userId)
                // Refresh user data
                try await authService.fetchCurrentUser()
                await MainActor.run {
                    isResettingData = false
                }
            } catch {
                await MainActor.run {
                    isResettingData = false
                }
            }
        }
    }
}

// MARK: - Password Reset Overlay

struct PasswordResetOverlay: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    let prefilledEmail: String
    var onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            PasswordResetView(
                onBackToLogin: onDismiss,
                prefilledEmail: prefilledEmail
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: onDismiss) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(theme.secondaryTextColor)
                    }
                }
            }
        }
    }
}

// MARK: - Email Edit Sheet

struct EmailEditSheet: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    let currentEmail: String
    var onDismiss: () -> Void

    @State private var newEmail = ""
    @State private var password = ""
    @State private var isSubmitting = false
    @State private var showError = false
    @State private var errorMessage = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Text(i18n.translate("settings.changeEmail"))
                    .font(.title2)
                    .fontWeight(.bold)

                Text(i18n.translate("settings.changeEmailWarning"))
                    .font(.subheadline)
                    .foregroundColor(theme.secondaryTextColor)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                VStack(alignment: .leading, spacing: 8) {
                    Text(i18n.translate("settings.newEmail"))
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)

                    TextField(currentEmail, text: $newEmail)
                        .textFieldStyle(GenieTextFieldStyle())
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                }
                .padding(.horizontal)

                VStack(alignment: .leading, spacing: 8) {
                    Text(i18n.translate("settings.enterPasswordConfirm"))
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)

                    SecureField(i18n.translate("settings.currentPasswordPlaceholder"), text: $password)
                        .textFieldStyle(GenieTextFieldStyle())
                }
                .padding(.horizontal)

                if showError {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundColor(theme.errorColor)
                        .padding(.horizontal)
                }

                Spacer()

                HStack(spacing: 16) {
                    Button(action: onDismiss) {
                        Text(i18n.translate("common.cancel"))
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.gray.opacity(0.2))
                            .foregroundColor(theme.primaryTextColor)
                            .cornerRadius(12)
                    }

                    Button(action: updateEmail) {
                        HStack {
                            if isSubmitting {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            }
                            Text(i18n.translate("settings.saveEmail"))
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(canSubmit ? theme.primaryColor : Color.gray)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(!canSubmit || isSubmitting)
                }
                .padding(.horizontal)
                .padding(.bottom)
            }
            .padding(.top, 24)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: onDismiss) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(theme.secondaryTextColor)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var canSubmit: Bool {
        !newEmail.isEmpty && !password.isEmpty && newEmail != currentEmail
    }

    private func updateEmail() {
        guard let userId = authService.currentUser?.id else { return }
        isSubmitting = true
        showError = false

        Task {
            do {
                let userService = UserService()
                try await userService.updateEmail(userId: userId, newEmail: newEmail, password: password)
                // Logout after email change
                await authService.logout()
                await MainActor.run {
                    onDismiss()
                }
            } catch {
                await MainActor.run {
                    isSubmitting = false
                    errorMessage = i18n.translate("settings.failedToUpdateEmail")
                    showError = true
                }
            }
        }
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
        .environment(ConnectivityService())
}
