// UserProfileView.swift
// User profile with tabbed sections matching Flutter's 12-tab layout

import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct UserProfileView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n
    @Environment(\.dismiss) private var dismiss

    @State private var userService = UserService()
    @State private var selectedTab = 0
    @State private var personalInfo = PersonalIdentification()
    @State private var civilInfo = CivilRegistration()
    @State private var addressInfo = AddressResidency()
    @State private var identityInfo = IdentityTravel()
    @State private var healthInfo = HealthMedical()
    @State private var employmentInfo = Employment()
    @State private var educationInfo = Education()
    @State private var financialInfo = FinancialTax()
    @State private var socialInfo = SocialSecurity()
    @State private var criminalInfo = CriminalLegal()
    @State private var transportInfo = Transportation()
    @State private var civicInfo = CivicParticipation()
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var hasChanges = false
    @State private var showDiscardAlert = false
    @State private var showIconSelector = false
    @State private var pickedFiles: [String: URL] = [:]

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
                // Profile Avatar + Privacy Notice
                VStack(spacing: 20) {
                    ProfileAvatarSection(
                        personalInfo: $personalInfo,
                        hasChanges: $hasChanges,
                        pickedFiles: $pickedFiles,
                        showIconSelector: $showIconSelector
                    )

                    Text(i18n.translate("userProfile.privacyInfo"))
                        .font(.subheadline)
                        .foregroundColor(.gray)
                        .multilineTextAlignment(.center)

                    Button(action: {
                        // Privacy policy link placeholder
                    }) {
                        Text(i18n.translate("userProfile.privacyPolicyLink"))
                            .font(.subheadline)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity)
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
                    PersonalDataTab(personalInfo: $personalInfo, hasChanges: $hasChanges)
                        .tag(0)

                    CivilRegistrationTab(civilInfo: $civilInfo, hasChanges: $hasChanges, pickedFiles: $pickedFiles)
                        .tag(1)

                    AddressTab(addressInfo: $addressInfo, hasChanges: $hasChanges, pickedFiles: $pickedFiles)
                        .tag(2)

                    IdentityTravelTab(identityInfo: $identityInfo, hasChanges: $hasChanges, pickedFiles: $pickedFiles)
                        .tag(3)

                    HealthMedicalTab(healthInfo: $healthInfo, hasChanges: $hasChanges, pickedFiles: $pickedFiles)
                        .tag(4)

                    EmploymentTab(employmentInfo: $employmentInfo, hasChanges: $hasChanges, pickedFiles: $pickedFiles)
                        .tag(5)

                    EducationTab(educationInfo: $educationInfo, hasChanges: $hasChanges)
                        .tag(6)

                    FinancialTaxTab(financialInfo: $financialInfo, hasChanges: $hasChanges, pickedFiles: $pickedFiles)
                        .tag(7)

                    SocialSecurityTab(socialInfo: $socialInfo, hasChanges: $hasChanges)
                        .tag(8)

                    CriminalLegalTab(criminalInfo: $criminalInfo, hasChanges: $hasChanges, pickedFiles: $pickedFiles)
                        .tag(9)

                    TransportationTab(transportInfo: $transportInfo, hasChanges: $hasChanges, pickedFiles: $pickedFiles)
                        .tag(10)

                    CivicParticipationTab(civicInfo: $civicInfo, hasChanges: $hasChanges)
                        .tag(11)
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
            .sheet(isPresented: $showIconSelector) {
                ProfileIconSelectorSheet(
                    personalInfo: $personalInfo,
                    hasChanges: $hasChanges,
                    pickedFiles: $pickedFiles
                )
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
            personalInfo = user.personalIdentification ?? PersonalIdentification()
            civilInfo = user.civilRegistration ?? CivilRegistration()
            addressInfo = user.addressResidency ?? AddressResidency()
            identityInfo = user.identityTravel ?? IdentityTravel()
            healthInfo = user.healthMedical ?? HealthMedical()
            employmentInfo = user.employment ?? Employment()
            educationInfo = user.education ?? Education()
            financialInfo = user.financialTax ?? FinancialTax()
            socialInfo = user.socialSecurity ?? SocialSecurity()
            criminalInfo = user.criminalLegal ?? CriminalLegal()
            transportInfo = user.transportation ?? Transportation()
            civicInfo = user.civicParticipation ?? CivicParticipation()
        } catch {
            print("[UserProfileView] Load error: \(error)")
        }
    }

    private func saveProfile() {
        guard let userId = authService.currentUser?.id else { return }

        isSaving = true

        Task {
            do {
                _ = try await userService.updateProfile(
                    userId: userId,
                    personalIdentification: personalInfo,
                    civilRegistration: civilInfo,
                    addressResidency: addressInfo,
                    identityTravel: identityInfo,
                    healthMedical: healthInfo,
                    employment: employmentInfo,
                    education: educationInfo,
                    financialTax: financialInfo,
                    socialSecurity: socialInfo,
                    criminalLegal: criminalInfo,
                    transportation: transportInfo,
                    civicParticipation: civicInfo,
                    files: pickedFiles
                )
                await MainActor.run {
                    isSaving = false
                    hasChanges = false
                    pickedFiles.removeAll()
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

// MARK: - Profile Avatar Section

struct ProfileAvatarSection: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    @Binding var personalInfo: PersonalIdentification
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]
    @Binding var showIconSelector: Bool

    private var initials: String {
        guard let name = personalInfo.fullName, !name.trimmingCharacters(in: .whitespaces).isEmpty else {
            return "?"
        }
        let parts = name.trimmingCharacters(in: .whitespaces).split(separator: " ")
        if parts.count >= 2, let first = parts[0].first, let second = parts[1].first {
            return "\(first)\(second)".uppercased()
        }
        return String(name.prefix(1)).uppercased()
    }

    private var initialsColor: Color {
        if let icon = personalInfo.profileIcon, icon.hasPrefix("initials:") {
            let hex = String(icon.dropFirst("initials:".count))
            return Color(hex: hex)
        }
        return Color(red: 78/255, green: 151/255, blue: 209/255)
    }

    private var isImageURL: Bool {
        guard let icon = personalInfo.profileIcon else { return false }
        return icon.hasPrefix("http")
    }

    private var localPickedImage: URL? {
        pickedFiles["personalIdentification-profileIcon"]
    }

    var body: some View {
        Button(action: { showIconSelector = true }) {
            ZStack(alignment: .bottomTrailing) {
                // Avatar circle
                Group {
                    if let localURL = localPickedImage {
                        AsyncImage(url: localURL) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            initialsCircle
                        }
                        .frame(width: 120, height: 120)
                        .clipShape(Circle())
                    } else if isImageURL, let urlString = personalInfo.profileIcon, let url = URL(string: urlString) {
                        AsyncImage(url: url) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            initialsCircle
                        }
                        .frame(width: 120, height: 120)
                        .clipShape(Circle())
                    } else {
                        initialsCircle
                    }
                }

                // Edit overlay
                Circle()
                    .fill(Color.black.opacity(0.6))
                    .frame(width: 36, height: 36)
                    .overlay(
                        Image(systemName: "pencil")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.white)
                    )
                    .offset(x: -4, y: -4)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var initialsCircle: some View {
        Circle()
            .fill(initialsColor)
            .frame(width: 120, height: 120)
            .overlay(
                Text(initials)
                    .font(.system(size: 50, weight: .bold))
                    .foregroundColor(.white)
            )
    }
}

// MARK: - Profile Icon Selector Sheet

struct ProfileIconSelectorSheet: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n
    @Environment(\.dismiss) private var dismiss

    @Binding var personalInfo: PersonalIdentification
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    @State private var selectedTabIndex = 0
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var selectedInitialsColor = Color(red: 78/255, green: 151/255, blue: 209/255)

    private let colorOptions: [(Color, String)] = [
        (Color(red: 78/255, green: 151/255, blue: 209/255), "#4E97D1"),
        (.green, "#4CAF50"),
        (.red, "#F44336"),
        (.purple, "#9C27B0"),
        (.orange, "#FF9800"),
        (.teal, "#009688"),
        (.pink, "#E91E63"),
        (.indigo, "#3F51B5"),
    ]

    private var initials: String {
        guard let name = personalInfo.fullName, !name.trimmingCharacters(in: .whitespaces).isEmpty else {
            return "?"
        }
        let parts = name.trimmingCharacters(in: .whitespaces).split(separator: " ")
        if parts.count >= 2, let first = parts[0].first, let second = parts[1].first {
            return "\(first)\(second)".uppercased()
        }
        return String(name.prefix(1)).uppercased()
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                // Tab selector
                Picker("", selection: $selectedTabIndex) {
                    Text(i18n.translate("userProfile.upload")).tag(0)
                    Text(i18n.translate("userProfile.initials")).tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)

                if selectedTabIndex == 0 {
                    uploadTab
                } else {
                    initialsTab
                }

                Spacer()
            }
            .padding(.top)
            .navigationTitle(i18n.translate("userProfile.chooseProfileIcon"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { dismiss() }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(theme.secondaryTextColor)
                    }
                }
            }
        }
    }

    // MARK: Upload Tab

    private var uploadTab: some View {
        VStack(spacing: 24) {
            // Preview
            if let localURL = pickedFiles["personalIdentification-profileIcon"] {
                AsyncImage(url: localURL) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    ProgressView()
                }
                .frame(width: 140, height: 140)
                .clipShape(Circle())
            }

            PhotosPicker(
                selection: $selectedPhotoItem,
                matching: .images
            ) {
                SwiftUI.Label(i18n.translate("userProfile.uploadPhoto"), systemImage: "photo.on.rectangle")
                    .font(.headline)
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(theme.primaryColor)
                    .foregroundColor(.white)
                    .cornerRadius(12)
            }
            .padding(.horizontal)
            .onChange(of: selectedPhotoItem) { _, newItem in
                guard let newItem else { return }
                Task {
                    guard let data = try? await newItem.loadTransferable(type: Data.self) else { return }
                    let tempDir = FileManager.default.temporaryDirectory
                    let filename = "profile_photo_\(UUID().uuidString).jpg"
                    let destURL = tempDir.appendingPathComponent(filename)
                    do {
                        try data.write(to: destURL)
                        await MainActor.run {
                            pickedFiles["personalIdentification-profileIcon"] = destURL
                            personalInfo.profileIcon = filename
                            hasChanges = true
                        }
                    } catch {
                        print("[ProfileIconSelector] Photo save error: \(error)")
                    }
                }
            }
        }
        .padding(.top, 20)
    }

    // MARK: Initials Tab

    private var initialsTab: some View {
        VStack(spacing: 24) {
            // Preview circle
            Circle()
                .fill(selectedInitialsColor)
                .frame(width: 140, height: 140)
                .overlay(
                    Text(initials)
                        .font(.system(size: 70, weight: .bold))
                        .foregroundColor(.white)
                )

            // Color swatches
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 4), spacing: 16) {
                ForEach(colorOptions, id: \.1) { color, hex in
                    Button(action: {
                        selectedInitialsColor = color
                        personalInfo.profileIcon = "initials:\(hex)"
                        pickedFiles.removeValue(forKey: "personalIdentification-profileIcon")
                        hasChanges = true
                    }) {
                        Circle()
                            .fill(color)
                            .frame(width: 60, height: 60)
                            .overlay(
                                Circle()
                                    .stroke(Color.white, lineWidth: selectedInitialsColor == color ? 4 : 0)
                            )
                            .shadow(radius: selectedInitialsColor == color ? 10 : 4)
                    }
                }
            }
            .padding(.horizontal)
        }
        .padding(.top, 20)
        .onAppear {
            // Initialize from current profileIcon if it's an initials value
            if let icon = personalInfo.profileIcon, icon.hasPrefix("initials:") {
                let hex = String(icon.dropFirst("initials:".count))
                if let match = colorOptions.first(where: { $0.1 == hex }) {
                    selectedInitialsColor = match.0
                }
            }
        }
    }
}

// MARK: - Personal Data Tab (Tab 0)

struct PersonalDataTab: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    @Binding var personalInfo: PersonalIdentification
    @Binding var hasChanges: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileField(
                    label: i18n.translate("userProfile.fields.fullName"),
                    text: Binding(
                        get: { personalInfo.fullName ?? "" },
                        set: { personalInfo.fullName = $0; hasChanges = true }
                    ),
                    placeholder: i18n.translate("userProfile.placeholders.fullName")
                )

                ProfileDateField(
                    label: i18n.translate("userProfile.fields.dob"),
                    dateString: Binding(
                        get: { personalInfo.dob ?? "" },
                        set: { personalInfo.dob = $0; hasChanges = true }
                    )
                )

                ProfilePickerField(
                    label: i18n.translate("userProfile.fields.gender"),
                    selection: Binding(
                        get: { personalInfo.gender ?? "" },
                        set: { personalInfo.gender = $0; hasChanges = true }
                    ),
                    options: [
                        ("male", i18n.translate("userProfile.gender.male")),
                        ("female", i18n.translate("userProfile.gender.female")),
                        ("other", i18n.translate("userProfile.gender.other")),
                        ("preferNot", i18n.translate("userProfile.gender.preferNot"))
                    ]
                )

                ProfileCountryPickerField(
                    label: i18n.translate("userProfile.fields.nationality"),
                    selection: Binding(
                        get: { personalInfo.nationality ?? "" },
                        set: { personalInfo.nationality = $0; hasChanges = true }
                    )
                )

                ProfilePickerField(
                    label: i18n.translate("userProfile.fields.maritalStatus"),
                    selection: Binding(
                        get: { personalInfo.maritalStatus ?? "" },
                        set: { personalInfo.maritalStatus = $0; hasChanges = true }
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

// MARK: - Civil Registration Tab (Tab 1)

struct CivilRegistrationTab: View {
    @Environment(I18nService.self) private var i18n

    @Binding var civilInfo: CivilRegistration
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.birthCert"),
                    filename: Binding(
                        get: { civilInfo.birthCert ?? "" },
                        set: { civilInfo.birthCert = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("civilRegistration-birthCert")
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.deathCert"),
                    filename: Binding(
                        get: { civilInfo.deathCert ?? "" },
                        set: { civilInfo.deathCert = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("civilRegistration-deathCert")
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.marriageDivorce"),
                    filename: Binding(
                        get: { civilInfo.marriageDivorce ?? "" },
                        set: { civilInfo.marriageDivorce = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("civilRegistration-marriageDivorce")
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.adoption"),
                    filename: Binding(
                        get: { civilInfo.adoption ?? "" },
                        set: { civilInfo.adoption = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("civilRegistration-adoption")
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.citizenship"),
                    filename: Binding(
                        get: { civilInfo.citizenship ?? "" },
                        set: { civilInfo.citizenship = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("civilRegistration-citizenship")
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.immigration"),
                    filename: Binding(
                        get: { civilInfo.immigration ?? "" },
                        set: { civilInfo.immigration = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("civilRegistration-immigration")
                )
            }
            .padding()
        }
    }

    private func fileBinding(_ key: String) -> Binding<URL?> {
        Binding(
            get: { pickedFiles[key] },
            set: { pickedFiles[key] = $0 }
        )
    }
}

// MARK: - Address Tab (Tab 2)

struct AddressTab: View {
    @Environment(I18nService.self) private var i18n

    @Binding var addressInfo: AddressResidency
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileField(
                    label: i18n.translate("userProfile.fields.currentAddress"),
                    text: Binding(
                        get: { addressInfo.currentAddress ?? "" },
                        set: { addressInfo.currentAddress = $0; hasChanges = true }
                    )
                )

                ProfileTextAreaField(
                    label: i18n.translate("userProfile.fields.previousAddresses"),
                    text: Binding(
                        get: { addressInfo.previousAddresses ?? "" },
                        set: { addressInfo.previousAddresses = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.homeOrRental"),
                    text: Binding(
                        get: { addressInfo.homeOrRental ?? "" },
                        set: { addressInfo.homeOrRental = $0; hasChanges = true }
                    )
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.utilityBills"),
                    filename: Binding(
                        get: { addressInfo.utilityBills ?? "" },
                        set: { addressInfo.utilityBills = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("addressResidency-utilityBills")
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.landRecords"),
                    filename: Binding(
                        get: { addressInfo.landRecords ?? "" },
                        set: { addressInfo.landRecords = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("addressResidency-landRecords")
                )
            }
            .padding()
        }
    }

    private func fileBinding(_ key: String) -> Binding<URL?> {
        Binding(
            get: { pickedFiles[key] },
            set: { pickedFiles[key] = $0 }
        )
    }
}

// MARK: - Identity & Travel Tab (Tab 3)

struct IdentityTravelTab: View {
    @Environment(I18nService.self) private var i18n

    @Binding var identityInfo: IdentityTravel
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileField(
                    label: i18n.translate("userProfile.fields.idCard"),
                    text: Binding(
                        get: { identityInfo.idCard ?? "" },
                        set: { identityInfo.idCard = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.passport"),
                    text: Binding(
                        get: { identityInfo.passport ?? "" },
                        set: { identityInfo.passport = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.driversLicense"),
                    text: Binding(
                        get: { identityInfo.driversLicense ?? "" },
                        set: { identityInfo.driversLicense = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.voterId"),
                    text: Binding(
                        get: { identityInfo.voterId ?? "" },
                        set: { identityInfo.voterId = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.ssn"),
                    text: Binding(
                        get: { identityInfo.ssn ?? "" },
                        set: { identityInfo.ssn = $0; hasChanges = true }
                    )
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.militaryRecords"),
                    filename: Binding(
                        get: { identityInfo.militaryRecords ?? "" },
                        set: { identityInfo.militaryRecords = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("identityTravel-militaryRecords")
                )
            }
            .padding()
        }
    }

    private func fileBinding(_ key: String) -> Binding<URL?> {
        Binding(
            get: { pickedFiles[key] },
            set: { pickedFiles[key] = $0 }
        )
    }
}

// MARK: - Health & Medical Tab (Tab 4)

struct HealthMedicalTab: View {
    @Environment(I18nService.self) private var i18n

    @Binding var healthInfo: HealthMedical
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileTextAreaField(
                    label: i18n.translate("userProfile.fields.medicalHistory"),
                    text: Binding(
                        get: { healthInfo.medicalHistory ?? "" },
                        set: { healthInfo.medicalHistory = $0; hasChanges = true }
                    )
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.vaccinations"),
                    filename: Binding(
                        get: { healthInfo.vaccinations ?? "" },
                        set: { healthInfo.vaccinations = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("healthMedical-vaccinations")
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.insuranceDetails"),
                    text: Binding(
                        get: { healthInfo.insuranceDetails ?? "" },
                        set: { healthInfo.insuranceDetails = $0; hasChanges = true }
                    )
                )

                ProfilePickerField(
                    label: i18n.translate("userProfile.fields.bloodType"),
                    selection: Binding(
                        get: { healthInfo.bloodType ?? "" },
                        set: { healthInfo.bloodType = $0; hasChanges = true }
                    ),
                    options: [
                        ("aPositive", i18n.translate("userProfile.bloodTypes.aPositive")),
                        ("aNegative", i18n.translate("userProfile.bloodTypes.aNegative")),
                        ("bPositive", i18n.translate("userProfile.bloodTypes.bPositive")),
                        ("bNegative", i18n.translate("userProfile.bloodTypes.bNegative")),
                        ("abPositive", i18n.translate("userProfile.bloodTypes.abPositive")),
                        ("abNegative", i18n.translate("userProfile.bloodTypes.abNegative")),
                        ("oPositive", i18n.translate("userProfile.bloodTypes.oPositive")),
                        ("oNegative", i18n.translate("userProfile.bloodTypes.oNegative")),
                        ("unknown", i18n.translate("userProfile.bloodTypes.unknown"))
                    ]
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.disability"),
                    text: Binding(
                        get: { healthInfo.disability ?? "" },
                        set: { healthInfo.disability = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.organDonor"),
                    text: Binding(
                        get: { healthInfo.organDonor ?? "" },
                        set: { healthInfo.organDonor = $0; hasChanges = true }
                    )
                )

                ProfileTextAreaField(
                    label: i18n.translate("userProfile.fields.prescriptions"),
                    text: Binding(
                        get: { healthInfo.prescriptions ?? "" },
                        set: { healthInfo.prescriptions = $0; hasChanges = true }
                    )
                )

                ProfileTextAreaField(
                    label: i18n.translate("userProfile.fields.mentalHealth"),
                    text: Binding(
                        get: { healthInfo.mentalHealth ?? "" },
                        set: { healthInfo.mentalHealth = $0; hasChanges = true }
                    )
                )
            }
            .padding()
        }
    }

    private func fileBinding(_ key: String) -> Binding<URL?> {
        Binding(
            get: { pickedFiles[key] },
            set: { pickedFiles[key] = $0 }
        )
    }
}

// MARK: - Employment Tab (Tab 5)

struct EmploymentTab: View {
    @Environment(I18nService.self) private var i18n

    @Binding var employmentInfo: Employment
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileTextAreaField(
                    label: i18n.translate("userProfile.fields.eHistory"),
                    text: Binding(
                        get: { employmentInfo.eHistory ?? "" },
                        set: { employmentInfo.eHistory = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.currentEmployer"),
                    text: Binding(
                        get: { employmentInfo.currentEmployer ?? "" },
                        set: { employmentInfo.currentEmployer = $0; hasChanges = true }
                    )
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.workPermits"),
                    filename: Binding(
                        get: { employmentInfo.workPermits ?? "" },
                        set: { employmentInfo.workPermits = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("employment-workPermits")
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.certifications"),
                    filename: Binding(
                        get: { employmentInfo.certifications ?? "" },
                        set: { employmentInfo.certifications = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("employment-certifications")
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.unemployment"),
                    text: Binding(
                        get: { employmentInfo.unemployment ?? "" },
                        set: { employmentInfo.unemployment = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.tin"),
                    text: Binding(
                        get: { employmentInfo.tin ?? "" },
                        set: { employmentInfo.tin = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.businessAffiliations"),
                    text: Binding(
                        get: { employmentInfo.businessAffiliations ?? "" },
                        set: { employmentInfo.businessAffiliations = $0; hasChanges = true }
                    )
                )
            }
            .padding()
        }
    }

    private func fileBinding(_ key: String) -> Binding<URL?> {
        Binding(
            get: { pickedFiles[key] },
            set: { pickedFiles[key] = $0 }
        )
    }
}

// MARK: - Education Tab (Tab 6)

struct EducationTab: View {
    @Environment(I18nService.self) private var i18n

    @Binding var educationInfo: Education
    @Binding var hasChanges: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileTextAreaField(
                    label: i18n.translate("userProfile.fields.schools"),
                    text: Binding(
                        get: { educationInfo.schools ?? "" },
                        set: { educationInfo.schools = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.degrees"),
                    text: Binding(
                        get: { educationInfo.diplomas ?? "" },
                        set: { educationInfo.diplomas = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.performance"),
                    text: Binding(
                        get: { educationInfo.performance ?? "" },
                        set: { educationInfo.performance = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.scholarships"),
                    text: Binding(
                        get: { educationInfo.scholarships ?? "" },
                        set: { educationInfo.scholarships = $0; hasChanges = true }
                    )
                )
            }
            .padding()
        }
    }
}

// MARK: - Financial & Tax Tab (Tab 7)

struct FinancialTaxTab: View {
    @Environment(I18nService.self) private var i18n

    @Binding var financialInfo: FinancialTax
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.incomeTax"),
                    filename: Binding(
                        get: { financialInfo.incomeTax ?? "" },
                        set: { financialInfo.incomeTax = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("financialTax-incomeTax")
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.bankAccounts"),
                    text: Binding(
                        get: { financialInfo.bankAccounts ?? "" },
                        set: { financialInfo.bankAccounts = $0; hasChanges = true }
                    )
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.propertyTax"),
                    filename: Binding(
                        get: { financialInfo.propertyTax ?? "" },
                        set: { financialInfo.propertyTax = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("financialTax-propertyTax")
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.businessTax"),
                    filename: Binding(
                        get: { financialInfo.businessTax ?? "" },
                        set: { financialInfo.businessTax = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("financialTax-businessTax")
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.pensionContrib"),
                    filename: Binding(
                        get: { financialInfo.pensionContrib ?? "" },
                        set: { financialInfo.pensionContrib = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("financialTax-pensionContrib")
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.loanAid"),
                    filename: Binding(
                        get: { financialInfo.loanAid ?? "" },
                        set: { financialInfo.loanAid = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("financialTax-loanAid")
                )
            }
            .padding()
        }
    }

    private func fileBinding(_ key: String) -> Binding<URL?> {
        Binding(
            get: { pickedFiles[key] },
            set: { pickedFiles[key] = $0 }
        )
    }
}

// MARK: - Social Security Tab (Tab 8)

struct SocialSecurityTab: View {
    @Environment(I18nService.self) private var i18n

    @Binding var socialInfo: SocialSecurity
    @Binding var hasChanges: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileField(
                    label: i18n.translate("userProfile.fields.pensionStatus"),
                    text: Binding(
                        get: { socialInfo.pensionStatus ?? "" },
                        set: { socialInfo.pensionStatus = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.unemployment"),
                    text: Binding(
                        get: { socialInfo.unemployment ?? "" },
                        set: { socialInfo.unemployment = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.disability"),
                    text: Binding(
                        get: { socialInfo.disability ?? "" },
                        set: { socialInfo.disability = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.childcare"),
                    text: Binding(
                        get: { socialInfo.childcare ?? "" },
                        set: { socialInfo.childcare = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.foodAssistance"),
                    text: Binding(
                        get: { socialInfo.foodAssistance ?? "" },
                        set: { socialInfo.foodAssistance = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.housingAssistance"),
                    text: Binding(
                        get: { socialInfo.housingAssistance ?? "" },
                        set: { socialInfo.housingAssistance = $0; hasChanges = true }
                    )
                )
            }
            .padding()
        }
    }
}

// MARK: - Criminal & Legal Tab (Tab 9)

struct CriminalLegalTab: View {
    @Environment(I18nService.self) private var i18n

    @Binding var criminalInfo: CriminalLegal
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.policeRecords"),
                    filename: Binding(
                        get: { criminalInfo.policeRecords ?? "" },
                        set: { criminalInfo.policeRecords = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("criminalLegal-policeRecords")
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.courtCases"),
                    filename: Binding(
                        get: { criminalInfo.courtCases ?? "" },
                        set: { criminalInfo.courtCases = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("criminalLegal-courtCases")
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.finesPenalties"),
                    filename: Binding(
                        get: { criminalInfo.finesPenalties ?? "" },
                        set: { criminalInfo.finesPenalties = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("criminalLegal-finesPenalties")
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.paroleProbation"),
                    text: Binding(
                        get: { criminalInfo.paroleProbation ?? "" },
                        set: { criminalInfo.paroleProbation = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.citizenshipRevocation"),
                    text: Binding(
                        get: { criminalInfo.citizenshipRevocation ?? "" },
                        set: { criminalInfo.citizenshipRevocation = $0; hasChanges = true }
                    )
                )
            }
            .padding()
        }
    }

    private func fileBinding(_ key: String) -> Binding<URL?> {
        Binding(
            get: { pickedFiles[key] },
            set: { pickedFiles[key] = $0 }
        )
    }
}

// MARK: - Transportation Tab (Tab 10)

struct TransportationTab: View {
    @Environment(I18nService.self) private var i18n

    @Binding var transportInfo: Transportation
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileField(
                    label: i18n.translate("userProfile.fields.vehicleReg"),
                    text: Binding(
                        get: { transportInfo.vehicleReg ?? "" },
                        set: { transportInfo.vehicleReg = $0; hasChanges = true }
                    )
                )

                ProfileFileUploadField(
                    label: i18n.translate("userProfile.fields.trafficViolations"),
                    filename: Binding(
                        get: { transportInfo.trafficViolations ?? "" },
                        set: { transportInfo.trafficViolations = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("transportation-trafficViolations")
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.licenseHistory"),
                    text: Binding(
                        get: { transportInfo.licenseHistory ?? "" },
                        set: { transportInfo.licenseHistory = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.publicTransportCard"),
                    text: Binding(
                        get: { transportInfo.publicTransportCard ?? "" },
                        set: { transportInfo.publicTransportCard = $0; hasChanges = true }
                    )
                )
            }
            .padding()
        }
    }

    private func fileBinding(_ key: String) -> Binding<URL?> {
        Binding(
            get: { pickedFiles[key] },
            set: { pickedFiles[key] = $0 }
        )
    }
}

// MARK: - Civic & Political Participation Tab (Tab 11)

struct CivicParticipationTab: View {
    @Environment(I18nService.self) private var i18n

    @Binding var civicInfo: CivicParticipation
    @Binding var hasChanges: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileField(
                    label: i18n.translate("userProfile.fields.voterRegistration"),
                    text: Binding(
                        get: { civicInfo.voterRegistration ?? "" },
                        set: { civicInfo.voterRegistration = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.electionHistory"),
                    text: Binding(
                        get: { civicInfo.electionHistory ?? "" },
                        set: { civicInfo.electionHistory = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.partyMembership"),
                    text: Binding(
                        get: { civicInfo.partyMembership ?? "" },
                        set: { civicInfo.partyMembership = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.militaryStatus"),
                    text: Binding(
                        get: { civicInfo.militaryStatus ?? "" },
                        set: { civicInfo.militaryStatus = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: i18n.translate("userProfile.fields.publicServiceRoles"),
                    text: Binding(
                        get: { civicInfo.publicServiceRoles ?? "" },
                        set: { civicInfo.publicServiceRoles = $0; hasChanges = true }
                    )
                )
            }
            .padding()
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

struct ProfilePickerField: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    let label: String
    @Binding var selection: String
    let options: [(String, String)]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)

            Picker("", selection: $selection) {
                Text(i18n.translate("userProfile.select"))
                    .tag("")
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

struct ProfileTextAreaField: View {
    @Environment(ThemeManager.self) private var theme

    let label: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)

            TextEditor(text: $text)
                .frame(minHeight: 100)
                .padding(8)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(10)
                .scrollContentBackground(.hidden)
        }
    }
}

struct ProfileFileUploadField: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    let label: String
    @Binding var filename: String
    @Binding var fileURL: URL?

    @State private var showFilePicker = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)

            Button(action: {
                showFilePicker = true
            }) {
                HStack {
                    Image(systemName: "doc.badge.arrow.up")
                        .foregroundColor(theme.primaryColor)
                    Text(filename.isEmpty
                         ? i18n.translate("userProfile.uploadFile")
                         : filename)
                        .foregroundColor(filename.isEmpty ? theme.secondaryTextColor : theme.primaryTextColor)
                    Spacer()
                    if !filename.isEmpty {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                    }
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(10)
            }
            .fileImporter(
                isPresented: $showFilePicker,
                allowedContentTypes: [.pdf, .png, .jpeg, .plainText],
                allowsMultipleSelection: false
            ) { result in
                switch result {
                case .success(let urls):
                    guard let sourceURL = urls.first else { return }
                    guard sourceURL.startAccessingSecurityScopedResource() else { return }
                    defer { sourceURL.stopAccessingSecurityScopedResource() }

                    let tempDir = FileManager.default.temporaryDirectory
                    let destURL = tempDir.appendingPathComponent(sourceURL.lastPathComponent)
                    try? FileManager.default.removeItem(at: destURL)
                    do {
                        try FileManager.default.copyItem(at: sourceURL, to: destURL)
                        filename = sourceURL.lastPathComponent
                        fileURL = destURL
                    } catch {
                        print("[ProfileFileUploadField] Copy error: \(error)")
                    }
                case .failure(let error):
                    print("[ProfileFileUploadField] Picker error: \(error)")
                }
            }
        }
    }
}

// MARK: - Date Picker Field

struct ProfileDateField: View {
    @Environment(ThemeManager.self) private var theme

    let label: String
    @Binding var dateString: String

    @State private var showDatePicker = false
    @State private var selectedDate = Date()

    private static let displayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)

            Button(action: { showDatePicker = true }) {
                HStack {
                    Text(dateString.isEmpty ? "YYYY-MM-DD" : dateString)
                        .foregroundColor(dateString.isEmpty ? theme.secondaryTextColor : theme.primaryTextColor)
                    Spacer()
                    Image(systemName: "calendar")
                        .foregroundColor(theme.primaryColor)
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(10)
            }
            .sheet(isPresented: $showDatePicker) {
                NavigationStack {
                    DatePicker(
                        "",
                        selection: $selectedDate,
                        in: ...Date(),
                        displayedComponents: .date
                    )
                    .datePickerStyle(.graphical)
                    .padding()
                    .navigationTitle(label)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") {
                                dateString = Self.displayFormatter.string(from: selectedDate)
                                showDatePicker = false
                            }
                        }
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") {
                                showDatePicker = false
                            }
                        }
                    }
                }
                .presentationDetents([.medium])
            }
        }
        .onAppear {
            if !dateString.isEmpty, let parsed = Self.displayFormatter.date(from: dateString) {
                selectedDate = parsed
            }
        }
        .onChange(of: dateString) { _, newValue in
            if let parsed = Self.displayFormatter.date(from: newValue) {
                selectedDate = parsed
            }
        }
    }
}

// MARK: - Country Picker Field

struct ProfileCountryPickerField: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    let label: String
    @Binding var selection: String

    @State private var showCountryPicker = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)

            Button(action: { showCountryPicker = true }) {
                HStack {
                    Image(systemName: "flag")
                        .foregroundColor(theme.primaryColor)
                    Text(selection.isEmpty
                         ? i18n.translate("userProfile.placeholders.selectCountry")
                         : selection)
                        .foregroundColor(selection.isEmpty ? theme.secondaryTextColor : theme.primaryTextColor)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.caption)
                        .foregroundColor(theme.secondaryTextColor)
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(10)
            }
            .sheet(isPresented: $showCountryPicker) {
                CountryPickerSheet(selection: $selection)
            }
        }
    }
}

// MARK: - Country Picker Sheet

struct CountryPickerSheet: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n
    @Environment(\.dismiss) private var dismiss

    @Binding var selection: String
    @State private var searchText = ""

    private var filteredCountries: [(String, String)] {
        let list = Self.countries
        if searchText.isEmpty { return list }
        return list.filter { $0.1.localizedCaseInsensitiveContains(searchText) }
    }

    var body: some View {
        NavigationStack {
            List(filteredCountries, id: \.1) { flag, name in
                Button(action: {
                    selection = name
                    dismiss()
                }) {
                    HStack(spacing: 12) {
                        Text(flag)
                            .font(.title2)
                        Text(name)
                            .foregroundColor(theme.primaryTextColor)
                        Spacer()
                        if selection == name {
                            Image(systemName: "checkmark")
                                .foregroundColor(theme.primaryColor)
                        }
                    }
                }
            }
            .searchable(text: $searchText, prompt: i18n.translate("userProfile.placeholders.searchCountries"))
            .navigationTitle(i18n.translate("userProfile.placeholders.selectCountry"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(action: { dismiss() }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(theme.secondaryTextColor)
                    }
                }
            }
        }
    }

    // ISO 3166-1 countries with flag emoji
    static let countries: [(String, String)] = {
        var result: [(String, String)] = []
        for code in Locale.Region.isoRegions {
            let identifier = code.identifier
            guard identifier.count == 2 else { continue }
            let flag = identifier.unicodeScalars.reduce("") { str, scalar in
                str + String(UnicodeScalar(127397 + scalar.value)!)
            }
            if let name = Locale.current.localizedString(forRegionCode: identifier) {
                result.append((flag, name))
            }
        }
        return result.sorted { $0.1 < $1.1 }
    }()
}

#Preview {
    UserProfileView()
        .environment(AuthService())
        .environment(ThemeManager())
        .environment(I18nService())
}
