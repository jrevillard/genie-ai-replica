// SettingsView.swift
// Settings screen for theme, language, account management, and user preferences

import SwiftUI

struct SettingsView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(AppLocaleService.self) private var appLocale
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
                Section(header: Text("Display")) {
                    // Language — opens iOS per-app language setting
                    Button {
                        AppLocaleService.openLanguageSettings()
                    } label: {
                        HStack {
                            Image(systemName: "globe")
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Display Language")
                                Text("Managed in iOS Settings")
                                    .font(.caption2)
                                    .foregroundColor(theme.secondaryTextColor)
                            }
                            Spacer()
                            Text(currentLanguageName)
                                .foregroundColor(theme.secondaryTextColor)
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundColor(theme.secondaryTextColor)
                        }
                    }
                    .foregroundColor(theme.primaryTextColor)

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
                            Text("Theme")
                        }
                    }

                    // Font Size Slider
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Image(systemName: "textformat.size")
                            Text("Font Size")
                            Spacer()
                            Text("\(Int(fontSize))%")
                                .foregroundColor(theme.secondaryTextColor)
                        }

                        Slider(value: $fontSize, in: 30...100, step: 5)
                            .tint(theme.primaryColor)
                    }

                    // Animations Toggle
                    Toggle(isOn: Binding(
                        get: { theme.animationsEnabled },
                        set: { theme.animationsEnabled = $0 }
                    )) {
                        HStack {
                            Image(systemName: "sparkles.rectangle.stack")
                            Text("Animations")
                        }
                    }

                    // Haptic Feedback Toggle
                    Toggle(isOn: Binding(
                        get: { theme.hapticsEnabled },
                        set: { theme.hapticsEnabled = $0 }
                    )) {
                        HStack {
                            Image(systemName: "hand.tap")
                            Text("Haptic Feedback")
                        }
                    }
                }

                // Notifications Section
                Section(header: Text("Notifications")) {
                    Toggle(isOn: $emailUpdates) {
                        HStack {
                            Image(systemName: "envelope")
                            Text("Email updates")
                        }
                    }
                    .disabled(!connectivity.isOnline)

                    Toggle(isOn: $soundNotifications) {
                        HStack {
                            Image(systemName: "speaker.wave.2")
                            Text("Sound notifications")
                        }
                    }
                    .disabled(!connectivity.isOnline)
                }

                // Account Section
                Section(header: Text("Account Management")) {
                    // Email with Edit
                    HStack {
                        Image(systemName: "envelope")
                        Text("settings.emailAddress")
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
                            Text("Change Password")
                        }
                    }
                    .disabled(!connectivity.isOnline)

                    // Reset Data
                    Button {
                        showResetDataAlert = true
                    } label: {
                        HStack {
                            Image(systemName: "arrow.counterclockwise")
                            Text("Reset User Data")
                        }
                    }
                    .disabled(!connectivity.isOnline)

                    // Delete Account
                    Button(role: .destructive) {
                        showDeleteAccountSheet = true
                    } label: {
                        HStack {
                            Image(systemName: "trash")
                            Text("Delete Account")
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
                            Text("Save Settings")
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
                            Text("About")
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button { dismiss() } label: {
                        Image(systemName: "checkmark")
                            .fontWeight(.semibold)
                    }
                    .accessibilityLabel(Text("Done"))
                }
            }
            .onAppear {
                fontSize = theme.fontSize
            }
            .alert("Reset User Data", isPresented: $showResetDataAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Reset", role: .destructive) {
                    resetUserData()
                }
            } message: {
                Text("Are you sure you want to reset all your profile data? This will clear all your profile information and chat history, but keep your account credentials.")
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
                        .shadow(color: theme.primaryColor.opacity(0.3), radius: 8, y: 2)

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

                    Text(authService.currentUser?.role?.capitalized ?? String(localized: "Standard Account"))
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
        appLocale.currentLanguageName
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
                        "language": appLocale.currentLocale
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
                Text("Change Email")
                    .font(.title2)
                    .fontWeight(.bold)

                Text("You will be logged out after changing your email")
                    .font(.subheadline)
                    .foregroundColor(theme.secondaryTextColor)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                VStack(alignment: .leading, spacing: 8) {
                    Text("New Email Address")
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)

                    TextField(currentEmail, text: $newEmail)
                        .textFieldStyle(GenieTextFieldStyle())
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                }
                .padding(.horizontal)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Enter your password to confirm:")
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)

                    SecureField(String(localized: "Your current password"), text: $password)
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
                        Text("Cancel")
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
                            Text("Update Email")
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
                    errorMessage = String(localized: "Failed to update email. Please try again.")
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

                    Text("Confirm Account Deletion")
                        .font(.headline)

                    Text("Warning: This action is permanent and cannot be undone. All your data will be permanently deleted.")
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)
                        .multilineTextAlignment(.center)
                }
                .padding()

                // Reason
                VStack(alignment: .leading, spacing: 8) {
                    Text("Reason for deletion (optional):")
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)

                    TextField("What made you decide to delete your account?", text: $reason, axis: .vertical)
                        .lineLimit(3)
                        .textFieldStyle(GenieTextFieldStyle())
                }
                .padding(.horizontal)

                // Password
                VStack(alignment: .leading, spacing: 8) {
                    Text("Enter your password to confirm:")
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)

                    SecureField(String(localized: "Your current password"), text: $password)
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
                        Text(isDeleting ? String(localized: "Deleting...") : String(localized: "Delete Account"))
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
            .navigationTitle("Delete Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel", action: onDismiss)
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
        .environment(AppLocaleService.shared)
        .environment(ConnectivityService())
}
