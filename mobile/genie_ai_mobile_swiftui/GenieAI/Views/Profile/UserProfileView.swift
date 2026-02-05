// UserProfileView.swift
// User profile with tabbed sections

import SwiftUI

struct UserProfileView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n
    @Environment(\.dismiss) private var dismiss

    @State private var userService = UserService()
    @State private var selectedTab = 0
    @State private var profile = UserProfile()
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var hasChanges = false
    @State private var showDiscardAlert = false

    private let tabs = [
        "userProfile.tabs.tab1",
        "userProfile.tabs.tab2",
        "userProfile.tabs.tab3",
        "userProfile.tabs.tab4",
        "userProfile.tabs.tab5",
        "userProfile.tabs.tab6",
        "userProfile.tabs.tab7",
        "userProfile.tabs.tab8",
        "userProfile.tabs.tab9",
        "userProfile.tabs.tab10",
        "userProfile.tabs.tab11",
        "userProfile.tabs.tab12"
    ]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Privacy Notice
                Text(i18n.translate("userProfile.privacyInfo"))
                    .font(.caption)
                    .foregroundColor(theme.secondaryTextColor)
                    .padding()
                    .background(theme.secondarySurfaceColor)

                // Tab Selector
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 0) {
                        ForEach(0..<tabs.count, id: \.self) { index in
                            Button(action: { selectedTab = index }) {
                                Text(i18n.translate(tabs[index]))
                                    .font(.caption)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .background(selectedTab == index ? theme.primaryColor : Color.clear)
                                    .foregroundColor(selectedTab == index ? .white : theme.primaryTextColor)
                                    .cornerRadius(16)
                            }
                        }
                    }
                    .padding()
                }
                .background(theme.secondarySurfaceColor)

                Divider()

                // Tab Content
                TabView(selection: $selectedTab) {
                    PersonalDataTab(profile: $profile, hasChanges: $hasChanges)
                        .tag(0)

                    ComingSoonTab()
                        .tag(1)

                    AddressTab(profile: $profile, hasChanges: $hasChanges)
                        .tag(2)

                    ForEach(3..<12, id: \.self) { index in
                        ComingSoonTab()
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

                // Navigation Buttons
                HStack {
                    Button(action: previousTab) {
                        HStack {
                            Image(systemName: "chevron.left")
                            Text(i18n.translate("userProfile.actions.previous"))
                        }
                    }
                    .disabled(selectedTab == 0)

                    Spacer()

                    if selectedTab < tabs.count - 1 {
                        Button(action: nextTab) {
                            HStack {
                                Text(i18n.translate("userProfile.actions.next"))
                                Image(systemName: "chevron.right")
                            }
                        }
                    }
                }
                .padding()
                .background(theme.secondarySurfaceColor)
            }
            .navigationTitle(i18n.translate("userProfile.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(i18n.translate("userProfile.actions.cancel")) {
                        if hasChanges {
                            showDiscardAlert = true
                        } else {
                            dismiss()
                        }
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: saveProfile) {
                        if isSaving {
                            ProgressView()
                        } else {
                            Text(i18n.translate("userProfile.actions.save"))
                        }
                    }
                    .disabled(!hasChanges || isSaving)
                }
            }
            .alert(i18n.translate("userProfile.confirmDiscardChanges"), isPresented: $showDiscardAlert) {
                Button(i18n.translate("common.cancel"), role: .cancel) {}
                Button(i18n.translate("common.confirm"), role: .destructive) {
                    dismiss()
                }
            }
            .task {
                await loadProfile()
            }
        }
    }

    private func previousTab() {
        withAnimation {
            selectedTab = max(0, selectedTab - 1)
        }
    }

    private func nextTab() {
        withAnimation {
            selectedTab = min(tabs.count - 1, selectedTab + 1)
        }
    }

    private func loadProfile() async {
        guard let userId = authService.currentUser?.id else { return }

        isLoading = true
        defer { isLoading = false }

        do {
            let user = try await userService.getProfile(userId: userId)
            profile = user.profile ?? UserProfile()
        } catch {
            print("[UserProfileView] Load error: \(error)")
        }
    }

    private func saveProfile() {
        guard let userId = authService.currentUser?.id else { return }

        isSaving = true

        Task {
            do {
                _ = try await userService.updateProfile(userId: userId, profile: profile)
                await MainActor.run {
                    isSaving = false
                    hasChanges = false
                }
            } catch {
                await MainActor.run {
                    isSaving = false
                }
                print("[UserProfileView] Save error: \(error)")
            }
        }
    }
}

// MARK: - Personal Data Tab

struct PersonalDataTab: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    @Binding var profile: UserProfile
    @Binding var hasChanges: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Full Name
                ProfileField(
                    label: i18n.translate("userProfile.fields.fullName"),
                    text: Binding(
                        get: { profile.fullName ?? "" },
                        set: { profile.fullName = $0; hasChanges = true }
                    ),
                    placeholder: i18n.translate("userProfile.placeholders.fullName")
                )

                // Date of Birth
                ProfileDateField(
                    label: i18n.translate("userProfile.fields.dob"),
                    date: Binding(
                        get: { profile.dateOfBirth ?? Date() },
                        set: { profile.dateOfBirth = $0; hasChanges = true }
                    )
                )

                // Gender
                ProfilePickerField(
                    label: i18n.translate("userProfile.fields.gender"),
                    selection: Binding(
                        get: { profile.gender ?? "" },
                        set: { profile.gender = $0; hasChanges = true }
                    ),
                    options: [
                        ("male", i18n.translate("userProfile.gender.male")),
                        ("female", i18n.translate("userProfile.gender.female")),
                        ("other", i18n.translate("userProfile.gender.other")),
                        ("preferNot", i18n.translate("userProfile.gender.preferNot"))
                    ]
                )

                // Nationality
                ProfileField(
                    label: i18n.translate("userProfile.fields.nationality"),
                    text: Binding(
                        get: { profile.nationality ?? "" },
                        set: { profile.nationality = $0; hasChanges = true }
                    ),
                    placeholder: i18n.translate("userProfile.placeholders.nationality")
                )

                // Marital Status
                ProfilePickerField(
                    label: i18n.translate("userProfile.fields.maritalStatus"),
                    selection: Binding(
                        get: { profile.maritalStatus ?? "" },
                        set: { profile.maritalStatus = $0; hasChanges = true }
                    ),
                    options: [
                        ("single", i18n.translate("userProfile.maritalStatus.single")),
                        ("married", i18n.translate("userProfile.maritalStatus.married")),
                        ("divorced", i18n.translate("userProfile.maritalStatus.divorced")),
                        ("widowed", i18n.translate("userProfile.maritalStatus.widowed")),
                        ("other", i18n.translate("userProfile.maritalStatus.other"))
                    ]
                )
            }
            .padding()
        }
    }
}

// MARK: - Address Tab

struct AddressTab: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    @Binding var profile: UserProfile
    @Binding var hasChanges: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileField(
                    label: i18n.translate("userProfile.fields.currentAddress"),
                    text: Binding(
                        get: { profile.currentAddress ?? "" },
                        set: { profile.currentAddress = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.postalCode"),
                    text: Binding(
                        get: { profile.postalCode ?? "" },
                        set: { profile.postalCode = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.country"),
                    text: Binding(
                        get: { profile.country ?? "" },
                        set: { profile.country = $0; hasChanges = true }
                    )
                )

                ProfilePickerField(
                    label: i18n.translate("userProfile.fields.residencyStatus"),
                    selection: Binding(
                        get: { profile.residencyStatus ?? "" },
                        set: { profile.residencyStatus = $0; hasChanges = true }
                    ),
                    options: [
                        ("citizen", i18n.translate("userProfile.residencyStatuses.citizen")),
                        ("permanentResident", i18n.translate("userProfile.residencyStatuses.permanentResident")),
                        ("temporaryResident", i18n.translate("userProfile.residencyStatuses.temporaryResident")),
                        ("other", i18n.translate("userProfile.residencyStatuses.other"))
                    ]
                )
            }
            .padding()
        }
    }
}

// MARK: - Coming Soon Tab

struct ComingSoonTab: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    var body: some View {
        VStack {
            Spacer()
            Image(systemName: "hammer.fill")
                .font(.largeTitle)
                .foregroundColor(theme.secondaryTextColor)
            Text(i18n.translate("userProfile.tabComingSoon"))
                .foregroundColor(theme.secondaryTextColor)
            Spacer()
        }
    }
}

// MARK: - Profile Field Components

struct ProfileField: View {
    @Environment(ThemeManager.self) private var theme

    let label: String
    @Binding var text: String
    var placeholder: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)

            TextField(placeholder, text: $text)
                .textFieldStyle(GenieTextFieldStyle())
        }
    }
}

struct ProfileDateField: View {
    @Environment(ThemeManager.self) private var theme

    let label: String
    @Binding var date: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)

            DatePicker("", selection: $date, displayedComponents: .date)
                .datePickerStyle(.compact)
                .labelsHidden()
        }
    }
}

struct ProfilePickerField: View {
    @Environment(ThemeManager.self) private var theme

    let label: String
    @Binding var selection: String
    let options: [(String, String)]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)

            Picker("", selection: $selection) {
                ForEach(options, id: \.0) { option in
                    Text(option.1).tag(option.0)
                }
            }
            .pickerStyle(.menu)
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(10)
        }
    }
}

#Preview {
    UserProfileView()
        .environment(AuthService())
        .environment(ThemeManager())
        .environment(I18nService())
}
