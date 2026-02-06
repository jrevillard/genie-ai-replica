// UserProfileView.swift
// User profile with tabbed sections matching Flutter's 12-tab layout

import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct UserProfileView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
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

    private let tabs: [LocalizedStringResource] = [
        "Personal Identification Data",
        "Civil Registration & Documentation",
        "Address & Residency Information",
        "Identity & Travel Documents",
        "Health & Medical Records",
        "Employment & Economic Data",
        "Education & Academic Records",
        "Financial & Tax Data",
        "Social Security & Welfare",
        "Criminal & Legal Records",
        "Transportation & Mobility",
        "Civic & Political Participation"
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

                    Text("By providing more information, you'll get more accurate and meaningful responses from the chatbot. Please review our")
                        .font(.subheadline)
                        .foregroundColor(.gray)
                        .multilineTextAlignment(.center)

                    Button(action: {
                        // Privacy policy link placeholder
                    }) {
                        Text("Privacy Policy")
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
                                Text(tabs[index])
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
                            Text("Previous")
                        }
                    }
                    .disabled(selectedTab == 0)

                    Spacer()

                    if selectedTab < tabs.count - 1 {
                        Button(action: nextTab) {
                            HStack {
                                Text("Next")
                                Image(systemName: "chevron.right")
                            }
                        }
                    }
                }
                .padding()
                .background(theme.secondarySurfaceColor)
            }
            .navigationTitle("User Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
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
                            Text("Save Profile")
                        }
                    }
                    .disabled(!hasChanges || isSaving)
                }
            }
            .alert("Discard unsaved changes?", isPresented: $showDiscardAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Confirm", role: .destructive) {
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
                    Text("Upload").tag(0)
                    Text("Initials").tag(1)
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
            .navigationTitle("Choose a Profile Icon")
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
                SwiftUI.Label("Upload Photo", systemImage: "photo.on.rectangle")
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

    @Binding var personalInfo: PersonalIdentification
    @Binding var hasChanges: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileField(
                    label: "Full name (including aliases)",
                    text: Binding(
                        get: { personalInfo.fullName ?? "" },
                        set: { personalInfo.fullName = $0; hasChanges = true }
                    ),
                    placeholder: String(localized: "Enter your full legal name")
                )

                ProfileDateField(
                    label: "Date of birth",
                    dateString: Binding(
                        get: { personalInfo.dob ?? "" },
                        set: { personalInfo.dob = $0; hasChanges = true }
                    )
                )

                ProfilePickerField(
                    label: "Gender",
                    selection: Binding(
                        get: { personalInfo.gender ?? "" },
                        set: { personalInfo.gender = $0; hasChanges = true }
                    ),
                    options: [
                        ("male", String(localized: "Male")),
                        ("female", String(localized: "Female")),
                        ("other", String(localized: "userProfile.gender.other")),
                        ("preferNot", String(localized: "Prefer not to say"))
                    ]
                )

                ProfileCountryPickerField(
                    label: "Nationality",
                    selection: Binding(
                        get: { personalInfo.nationality ?? "" },
                        set: { personalInfo.nationality = $0; hasChanges = true }
                    )
                )

                ProfilePickerField(
                    label: "Marital status",
                    selection: Binding(
                        get: { personalInfo.maritalStatus ?? "" },
                        set: { personalInfo.maritalStatus = $0; hasChanges = true }
                    ),
                    options: [
                        ("single", String(localized: "Single")),
                        ("married", String(localized: "Married")),
                        ("divorced", String(localized: "Divorced")),
                        ("widowed", String(localized: "Widowed")),
                        ("other", String(localized: "userProfile.maritalStatus.other"))
                    ]
                )
            }
            .padding()
        }
    }
}

// MARK: - Civil Registration Tab (Tab 1)

struct CivilRegistrationTab: View {

    @Binding var civilInfo: CivilRegistration
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileFileUploadField(
                    label: "Birth certificate",
                    filename: Binding(
                        get: { civilInfo.birthCert ?? "" },
                        set: { civilInfo.birthCert = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("civilRegistration-birthCert")
                )

                ProfileFileUploadField(
                    label: "Death certificate",
                    filename: Binding(
                        get: { civilInfo.deathCert ?? "" },
                        set: { civilInfo.deathCert = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("civilRegistration-deathCert")
                )

                ProfileFileUploadField(
                    label: "Marriage / Divorce records",
                    filename: Binding(
                        get: { civilInfo.marriageDivorce ?? "" },
                        set: { civilInfo.marriageDivorce = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("civilRegistration-marriageDivorce")
                )

                ProfileFileUploadField(
                    label: "Adoption records",
                    filename: Binding(
                        get: { civilInfo.adoption ?? "" },
                        set: { civilInfo.adoption = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("civilRegistration-adoption")
                )

                ProfileFileUploadField(
                    label: "Citizenship / Naturalization documents",
                    filename: Binding(
                        get: { civilInfo.citizenship ?? "" },
                        set: { civilInfo.citizenship = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("civilRegistration-citizenship")
                )

                ProfileFileUploadField(
                    label: "Immigration & visa history",
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

    @Binding var addressInfo: AddressResidency
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileField(
                    label: "Current residential address",
                    text: Binding(
                        get: { addressInfo.currentAddress ?? "" },
                        set: { addressInfo.currentAddress = $0; hasChanges = true }
                    )
                )

                ProfileTextAreaField(
                    label: "Previous addresses",
                    text: Binding(
                        get: { addressInfo.previousAddresses ?? "" },
                        set: { addressInfo.previousAddresses = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Homeownership or rental details",
                    text: Binding(
                        get: { addressInfo.homeOrRental ?? "" },
                        set: { addressInfo.homeOrRental = $0; hasChanges = true }
                    )
                )

                ProfileFileUploadField(
                    label: "Utility bills linked to the address",
                    filename: Binding(
                        get: { addressInfo.utilityBills ?? "" },
                        set: { addressInfo.utilityBills = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("addressResidency-utilityBills")
                )

                ProfileFileUploadField(
                    label: "Land and property ownership records",
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

    @Binding var identityInfo: IdentityTravel
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileField(
                    label: "National ID card number",
                    text: Binding(
                        get: { identityInfo.idCard ?? "" },
                        set: { identityInfo.idCard = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Passport details",
                    text: Binding(
                        get: { identityInfo.passport ?? "" },
                        set: { identityInfo.passport = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Driver's license",
                    text: Binding(
                        get: { identityInfo.driversLicense ?? "" },
                        set: { identityInfo.driversLicense = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Voter ID",
                    text: Binding(
                        get: { identityInfo.voterId ?? "" },
                        set: { identityInfo.voterId = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Social Security / National Insurance Number",
                    text: Binding(
                        get: { identityInfo.ssn ?? "" },
                        set: { identityInfo.ssn = $0; hasChanges = true }
                    )
                )

                ProfileFileUploadField(
                    label: "Military service records",
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

    @Binding var healthInfo: HealthMedical
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileTextAreaField(
                    label: "Medical history and health conditions",
                    text: Binding(
                        get: { healthInfo.medicalHistory ?? "" },
                        set: { healthInfo.medicalHistory = $0; hasChanges = true }
                    )
                )

                ProfileFileUploadField(
                    label: "Vaccination records",
                    filename: Binding(
                        get: { healthInfo.vaccinations ?? "" },
                        set: { healthInfo.vaccinations = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("healthMedical-vaccinations")
                )

                ProfileField(
                    label: "Health insurance details",
                    text: Binding(
                        get: { healthInfo.insuranceDetails ?? "" },
                        set: { healthInfo.insuranceDetails = $0; hasChanges = true }
                    )
                )

                ProfilePickerField(
                    label: "Blood Type",
                    selection: Binding(
                        get: { healthInfo.bloodType ?? "" },
                        set: { healthInfo.bloodType = $0; hasChanges = true }
                    ),
                    options: [
                        ("aPositive", "A+"),
                        ("aNegative", "A-"),
                        ("bPositive", "B+"),
                        ("bNegative", "B-"),
                        ("abPositive", "AB+"),
                        ("abNegative", "AB-"),
                        ("oPositive", "O+"),
                        ("oNegative", "O-"),
                        ("unknown", String(localized: "Unknown"))
                    ]
                )

                ProfileField(
                    label: "Disability status",
                    text: Binding(
                        get: { healthInfo.disability ?? "" },
                        set: { healthInfo.disability = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Organ donor status",
                    text: Binding(
                        get: { healthInfo.organDonor ?? "" },
                        set: { healthInfo.organDonor = $0; hasChanges = true }
                    )
                )

                ProfileTextAreaField(
                    label: "Prescriptions and treatments received",
                    text: Binding(
                        get: { healthInfo.prescriptions ?? "" },
                        set: { healthInfo.prescriptions = $0; hasChanges = true }
                    )
                )

                ProfileTextAreaField(
                    label: "Mental health history",
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

    @Binding var employmentInfo: Employment
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileTextAreaField(
                    label: "Employment history",
                    text: Binding(
                        get: { employmentInfo.eHistory ?? "" },
                        set: { employmentInfo.eHistory = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Current employer details",
                    text: Binding(
                        get: { employmentInfo.currentEmployer ?? "" },
                        set: { employmentInfo.currentEmployer = $0; hasChanges = true }
                    )
                )

                ProfileFileUploadField(
                    label: "Work permits and labor contracts",
                    filename: Binding(
                        get: { employmentInfo.workPermits ?? "" },
                        set: { employmentInfo.workPermits = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("employment-workPermits")
                )

                ProfileFileUploadField(
                    label: "Professional certifications and licenses",
                    filename: Binding(
                        get: { employmentInfo.certifications ?? "" },
                        set: { employmentInfo.certifications = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("employment-certifications")
                )

                ProfileField(
                    label: "Unemployment status and benefits received",
                    text: Binding(
                        get: { employmentInfo.unemployment ?? "" },
                        set: { employmentInfo.unemployment = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Taxpayer identification number (TIN)",
                    text: Binding(
                        get: { employmentInfo.tin ?? "" },
                        set: { employmentInfo.tin = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Business ownership and company affiliations",
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

    @Binding var educationInfo: Education
    @Binding var hasChanges: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileTextAreaField(
                    label: "School and university attended",
                    text: Binding(
                        get: { educationInfo.schools ?? "" },
                        set: { educationInfo.schools = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Diplomas, degrees, and certifications",
                    text: Binding(
                        get: { educationInfo.diplomas ?? "" },
                        set: { educationInfo.diplomas = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Academic performance and test scores",
                    text: Binding(
                        get: { educationInfo.performance ?? "" },
                        set: { educationInfo.performance = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Scholarships and financial aid received",
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

    @Binding var financialInfo: FinancialTax
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileFileUploadField(
                    label: "Income tax records",
                    filename: Binding(
                        get: { financialInfo.incomeTax ?? "" },
                        set: { financialInfo.incomeTax = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("financialTax-incomeTax")
                )

                ProfileField(
                    label: "Banking and financial accounts",
                    text: Binding(
                        get: { financialInfo.bankAccounts ?? "" },
                        set: { financialInfo.bankAccounts = $0; hasChanges = true }
                    )
                )

                ProfileFileUploadField(
                    label: "Property tax payments",
                    filename: Binding(
                        get: { financialInfo.propertyTax ?? "" },
                        set: { financialInfo.propertyTax = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("financialTax-propertyTax")
                )

                ProfileFileUploadField(
                    label: "Business tax filings",
                    filename: Binding(
                        get: { financialInfo.businessTax ?? "" },
                        set: { financialInfo.businessTax = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("financialTax-businessTax")
                )

                ProfileFileUploadField(
                    label: "Pension contributions and withdrawals",
                    filename: Binding(
                        get: { financialInfo.pensionContrib ?? "" },
                        set: { financialInfo.pensionContrib = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("financialTax-pensionContrib")
                )

                ProfileFileUploadField(
                    label: "Loan and government aid records",
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

    @Binding var socialInfo: SocialSecurity
    @Binding var hasChanges: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileField(
                    label: "Pension status and contributions",
                    text: Binding(
                        get: { socialInfo.pensionStatus ?? "" },
                        set: { socialInfo.pensionStatus = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Unemployment status and benefits received",
                    text: Binding(
                        get: { socialInfo.unemployment ?? "" },
                        set: { socialInfo.unemployment = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Disability status",
                    text: Binding(
                        get: { socialInfo.disability ?? "" },
                        set: { socialInfo.disability = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Childcare support",
                    text: Binding(
                        get: { socialInfo.childcare ?? "" },
                        set: { socialInfo.childcare = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Food assistance / welfare programs",
                    text: Binding(
                        get: { socialInfo.foodAssistance ?? "" },
                        set: { socialInfo.foodAssistance = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Housing assistance",
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

    @Binding var criminalInfo: CriminalLegal
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileFileUploadField(
                    label: "Police records (criminal history, arrests, charges)",
                    filename: Binding(
                        get: { criminalInfo.policeRecords ?? "" },
                        set: { criminalInfo.policeRecords = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("criminalLegal-policeRecords")
                )

                ProfileFileUploadField(
                    label: "Court case history",
                    filename: Binding(
                        get: { criminalInfo.courtCases ?? "" },
                        set: { criminalInfo.courtCases = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("criminalLegal-courtCases")
                )

                ProfileFileUploadField(
                    label: "Fines and penalties",
                    filename: Binding(
                        get: { criminalInfo.finesPenalties ?? "" },
                        set: { criminalInfo.finesPenalties = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("criminalLegal-finesPenalties")
                )

                ProfileField(
                    label: "Parole or probation status",
                    text: Binding(
                        get: { criminalInfo.paroleProbation ?? "" },
                        set: { criminalInfo.paroleProbation = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Citizenship revocation (if applicable)",
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

    @Binding var transportInfo: Transportation
    @Binding var hasChanges: Bool
    @Binding var pickedFiles: [String: URL]

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileField(
                    label: "Vehicle registration details",
                    text: Binding(
                        get: { transportInfo.vehicleReg ?? "" },
                        set: { transportInfo.vehicleReg = $0; hasChanges = true }
                    )
                )

                ProfileFileUploadField(
                    label: "Traffic violations and fines",
                    filename: Binding(
                        get: { transportInfo.trafficViolations ?? "" },
                        set: { transportInfo.trafficViolations = $0; hasChanges = true }
                    ),
                    fileURL: fileBinding("transportation-trafficViolations")
                )

                ProfileField(
                    label: "Driving license history and endorsements",
                    text: Binding(
                        get: { transportInfo.licenseHistory ?? "" },
                        set: { transportInfo.licenseHistory = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Public transport card usage",
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

    @Binding var civicInfo: CivicParticipation
    @Binding var hasChanges: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                ProfileField(
                    label: "Voter registration details",
                    text: Binding(
                        get: { civicInfo.voterRegistration ?? "" },
                        set: { civicInfo.voterRegistration = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Election participation history",
                    text: Binding(
                        get: { civicInfo.electionHistory ?? "" },
                        set: { civicInfo.electionHistory = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Political party membership",
                    text: Binding(
                        get: { civicInfo.partyMembership ?? "" },
                        set: { civicInfo.partyMembership = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Military service or conscription status",
                    text: Binding(
                        get: { civicInfo.militaryStatus ?? "" },
                        set: { civicInfo.militaryStatus = $0; hasChanges = true }
                    )
                )

                ProfileField(
                    label: "Public service roles",
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

    let label: String
    @Binding var selection: String
    let options: [(String, String)]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)

            Picker("", selection: $selection) {
                Text("Please select")
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
                         ? String(localized: "Upload File")
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
                         ? String(localized: "Select a country")
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
            .searchable(text: $searchText, prompt: String(localized: "Search countries..."))
            .navigationTitle("Select a country")
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
}
