// UserProfileView.swift
// User profile with navigation-based sections matching Flutter's 12-tab layout

import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct UserProfileView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var userService = UserService()
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

    private struct ProfileCategory: Identifiable {
        let id: Int
        let title: LocalizedStringResource
        let icon: String
        let color: Color
    }

    private let categories: [ProfileCategory] = [
        ProfileCategory(id: 0, title: "Personal Identification Data", icon: "person.text.rectangle", color: CategoryPalette.colors[4]),
        ProfileCategory(id: 1, title: "Civil Registration & Documentation", icon: "doc.text", color: CategoryPalette.colors[10]),
        ProfileCategory(id: 2, title: "Address & Residency Information", icon: "house", color: CategoryPalette.colors[1]),
        ProfileCategory(id: 3, title: "Identity & Travel Documents", icon: "airplane", color: CategoryPalette.colors[0]),
        ProfileCategory(id: 4, title: "Health & Medical Records", icon: "heart.text.square", color: CategoryPalette.colors[2]),
        ProfileCategory(id: 5, title: "Employment & Economic Data", icon: "briefcase", color: CategoryPalette.colors[9]),
        ProfileCategory(id: 6, title: "Education & Academic Records", icon: "graduationcap", color: CategoryPalette.colors[3]),
        ProfileCategory(id: 7, title: "Financial & Tax Data", icon: "dollarsign.circle", color: CategoryPalette.colors[11]),
        ProfileCategory(id: 8, title: "Social Security & Welfare", icon: "person.2", color: CategoryPalette.colors[7]),
        ProfileCategory(id: 9, title: "Criminal & Legal Records", icon: "building.columns", color: CategoryPalette.colors[8]),
        ProfileCategory(id: 10, title: "Transportation & Mobility", icon: "car", color: CategoryPalette.colors[5]),
        ProfileCategory(id: 11, title: "Civic & Political Participation", icon: "flag", color: CategoryPalette.colors[6]),
    ]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ProfileAvatarSection(
                        personalInfo: $personalInfo,
                        hasChanges: $hasChanges,
                        pickedFiles: $pickedFiles,
                        showIconSelector: $showIconSelector
                    )
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    .frame(maxWidth: .infinity)

                    privacyNotice
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
                }

                Section {
                    ForEach(categories) { category in
                        NavigationLink {
                            categoryDetailView(category)
                        } label: {
                            HStack(spacing: 14) {
                                Image(systemName: category.icon)
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundColor(.white)
                                    .frame(width: 30, height: 30)
                                    .background(category.color, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                                Text(category.title)
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("User Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        if hasChanges {
                            showDiscardAlert = true
                        } else {
                            dismiss()
                        }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .accessibilityLabel(Text("Close"))
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button(action: saveProfile) {
                        if isSaving {
                            ProgressView()
                        } else {
                            Image(systemName: "checkmark")
                                .fontWeight(.semibold)
                                .foregroundColor(theme.primaryColor)
                        }
                    }
                    .disabled(!hasChanges || isSaving)
                    .accessibilityLabel(Text("Save"))
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

    // MARK: - Privacy Notice

    private var privacyNotice: some View {
        VStack(spacing: 8) {
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
        .padding(.vertical, 8)
    }

    // MARK: - Category Detail Views

    @ViewBuilder
    private func categoryDetailView(_ category: ProfileCategory) -> some View {
        switch category.id {
        case 0:
            PersonalDataTab(personalInfo: $personalInfo, hasChanges: $hasChanges, isSaving: $isSaving, onSave: saveProfile)
        case 1:
            CivilRegistrationTab(civilInfo: $civilInfo, hasChanges: $hasChanges, isSaving: $isSaving, onSave: saveProfile, fileBinding: fileBinding)
        case 2:
            AddressTab(addressInfo: $addressInfo, hasChanges: $hasChanges, isSaving: $isSaving, onSave: saveProfile, fileBinding: fileBinding)
        case 3:
            IdentityTravelTab(identityInfo: $identityInfo, hasChanges: $hasChanges, isSaving: $isSaving, onSave: saveProfile, fileBinding: fileBinding)
        case 4:
            HealthMedicalTab(healthInfo: $healthInfo, hasChanges: $hasChanges, isSaving: $isSaving, onSave: saveProfile, fileBinding: fileBinding)
        case 5:
            EmploymentTab(employmentInfo: $employmentInfo, hasChanges: $hasChanges, isSaving: $isSaving, onSave: saveProfile, fileBinding: fileBinding)
        case 6:
            EducationTab(educationInfo: $educationInfo, hasChanges: $hasChanges, isSaving: $isSaving, onSave: saveProfile)
        case 7:
            FinancialTaxTab(financialInfo: $financialInfo, hasChanges: $hasChanges, isSaving: $isSaving, onSave: saveProfile, fileBinding: fileBinding)
        case 8:
            SocialSecurityTab(socialInfo: $socialInfo, hasChanges: $hasChanges, isSaving: $isSaving, onSave: saveProfile)
        case 9:
            CriminalLegalTab(criminalInfo: $criminalInfo, hasChanges: $hasChanges, isSaving: $isSaving, onSave: saveProfile, fileBinding: fileBinding)
        case 10:
            TransportationTab(transportInfo: $transportInfo, hasChanges: $hasChanges, isSaving: $isSaving, onSave: saveProfile, fileBinding: fileBinding)
        case 11:
            CivicParticipationTab(civicInfo: $civicInfo, hasChanges: $hasChanges, isSaving: $isSaving, onSave: saveProfile)
        default:
            EmptyView()
        }
    }

    // MARK: - File Binding Helper

    func fileBinding(_ key: String) -> Binding<URL?> {
        Binding(
            get: { pickedFiles[key] },
            set: { pickedFiles[key] = $0 }
        )
    }

    // MARK: - Load / Save

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
                    dismiss()
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

// MARK: - Profile Save Toolbar Modifier

private struct ProfileSaveToolbar: ViewModifier {
    @Environment(ThemeManager.self) private var theme
    @Binding var hasChanges: Bool
    @Binding var isSaving: Bool
    var onSave: () -> Void

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: onSave) {
                        if isSaving {
                            ProgressView()
                        } else {
                            Image(systemName: "checkmark")
                                .fontWeight(.semibold)
                                .foregroundColor(theme.primaryColor)
                        }
                    }
                    .disabled(!hasChanges || isSaving)
                    .accessibilityLabel(Text("Save"))
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
        return theme.primaryColor
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
        .padding(.vertical, 12)
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
    @State private var selectedInitialsColor = Color(red: 91/255, green: 159/255, blue: 214/255)

    private let colorOptions: [(Color, String)] = [
        (Color(red: 91/255, green: 159/255, blue: 214/255), "#5B9FD6"),
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
                ToolbarItem(placement: .cancellationAction) {
                    Button(action: { dismiss() }) {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .accessibilityLabel(Text("Close"))
                }
            }
        }
    }

    private var uploadTab: some View {
        VStack(spacing: 24) {
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
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
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

    private var initialsTab: some View {
        VStack(spacing: 24) {
            Circle()
                .fill(selectedInitialsColor)
                .frame(width: 140, height: 140)
                .overlay(
                    Text(initials)
                        .font(.system(size: 70, weight: .bold))
                        .foregroundColor(.white)
                )

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
            if let icon = personalInfo.profileIcon, icon.hasPrefix("initials:") {
                let hex = String(icon.dropFirst("initials:".count))
                if let match = colorOptions.first(where: { $0.1 == hex }) {
                    selectedInitialsColor = match.0
                }
            }
        }
    }
}

// MARK: - Personal Data Tab

struct PersonalDataTab: View {
    @Binding var personalInfo: PersonalIdentification
    @Binding var hasChanges: Bool
    @Binding var isSaving: Bool
    var onSave: () -> Void

    var body: some View {
        Form {
            Section("Basic Information") {
                TextField("Full name (including aliases)", text: Binding(
                    get: { personalInfo.fullName ?? "" },
                    set: { personalInfo.fullName = $0; hasChanges = true }
                ))
                ProfileDateField(
                    dateString: Binding(
                        get: { personalInfo.dob ?? "" },
                        set: { personalInfo.dob = $0; hasChanges = true }
                    )
                )
                Picker("Gender", selection: Binding(
                    get: { personalInfo.gender ?? "" },
                    set: { personalInfo.gender = $0; hasChanges = true }
                )) {
                    Text("Please select").tag("")
                    Text("Male").tag("male")
                    Text("Female").tag("female")
                    Text(String(localized: "userProfile.gender.other")).tag("other")
                    Text("Prefer not to say").tag("preferNot")
                }
            }

            Section("Nationality & Status") {
                ProfileCountryPickerField(
                    selection: Binding(
                        get: { personalInfo.nationality ?? "" },
                        set: { personalInfo.nationality = $0; hasChanges = true }
                    )
                )
                Picker("Marital status", selection: Binding(
                    get: { personalInfo.maritalStatus ?? "" },
                    set: { personalInfo.maritalStatus = $0; hasChanges = true }
                )) {
                    Text("Please select").tag("")
                    Text("Single").tag("single")
                    Text("Married").tag("married")
                    Text("Divorced").tag("divorced")
                    Text("Widowed").tag("widowed")
                    Text(String(localized: "userProfile.maritalStatus.other")).tag("other")
                }
            }
        }
        .navigationTitle("Personal Identification")
        .modifier(ProfileSaveToolbar(hasChanges: $hasChanges, isSaving: $isSaving, onSave: onSave))
    }
}

// MARK: - Civil Registration Tab

struct CivilRegistrationTab: View {
    @Binding var civilInfo: CivilRegistration
    @Binding var hasChanges: Bool
    @Binding var isSaving: Bool
    var onSave: () -> Void
    var fileBinding: (String) -> Binding<URL?>

    var body: some View {
        Form {
            Section("Certificates") {
                ProfileFileUploadField(
                    label: "Birth certificate",
                    filename: Binding(get: { civilInfo.birthCert ?? "" }, set: { civilInfo.birthCert = $0; hasChanges = true }),
                    fileURL: fileBinding("civilRegistration-birthCert")
                )
                ProfileFileUploadField(
                    label: "Death certificate",
                    filename: Binding(get: { civilInfo.deathCert ?? "" }, set: { civilInfo.deathCert = $0; hasChanges = true }),
                    fileURL: fileBinding("civilRegistration-deathCert")
                )
                ProfileFileUploadField(
                    label: "Marriage / Divorce records",
                    filename: Binding(get: { civilInfo.marriageDivorce ?? "" }, set: { civilInfo.marriageDivorce = $0; hasChanges = true }),
                    fileURL: fileBinding("civilRegistration-marriageDivorce")
                )
                ProfileFileUploadField(
                    label: "Adoption records",
                    filename: Binding(get: { civilInfo.adoption ?? "" }, set: { civilInfo.adoption = $0; hasChanges = true }),
                    fileURL: fileBinding("civilRegistration-adoption")
                )
            }
            Section("Citizenship & Immigration") {
                ProfileFileUploadField(
                    label: "Citizenship / Naturalization documents",
                    filename: Binding(get: { civilInfo.citizenship ?? "" }, set: { civilInfo.citizenship = $0; hasChanges = true }),
                    fileURL: fileBinding("civilRegistration-citizenship")
                )
                ProfileFileUploadField(
                    label: "Immigration & visa history",
                    filename: Binding(get: { civilInfo.immigration ?? "" }, set: { civilInfo.immigration = $0; hasChanges = true }),
                    fileURL: fileBinding("civilRegistration-immigration")
                )
            }
        }
        .navigationTitle("Civil Registration")
        .modifier(ProfileSaveToolbar(hasChanges: $hasChanges, isSaving: $isSaving, onSave: onSave))
    }
}

// MARK: - Address Tab

struct AddressTab: View {
    @Binding var addressInfo: AddressResidency
    @Binding var hasChanges: Bool
    @Binding var isSaving: Bool
    var onSave: () -> Void
    var fileBinding: (String) -> Binding<URL?>

    var body: some View {
        Form {
            Section("Address") {
                TextField("Current residential address", text: Binding(
                    get: { addressInfo.currentAddress ?? "" },
                    set: { addressInfo.currentAddress = $0; hasChanges = true }
                ))
                TextField("Previous addresses", text: Binding(
                    get: { addressInfo.previousAddresses ?? "" },
                    set: { addressInfo.previousAddresses = $0; hasChanges = true }
                ), axis: .vertical)
                .lineLimit(3...6)
                TextField("Homeownership or rental details", text: Binding(
                    get: { addressInfo.homeOrRental ?? "" },
                    set: { addressInfo.homeOrRental = $0; hasChanges = true }
                ))
            }
            Section("Documents") {
                ProfileFileUploadField(
                    label: "Utility bills linked to the address",
                    filename: Binding(get: { addressInfo.utilityBills ?? "" }, set: { addressInfo.utilityBills = $0; hasChanges = true }),
                    fileURL: fileBinding("addressResidency-utilityBills")
                )
                ProfileFileUploadField(
                    label: "Land and property ownership records",
                    filename: Binding(get: { addressInfo.landRecords ?? "" }, set: { addressInfo.landRecords = $0; hasChanges = true }),
                    fileURL: fileBinding("addressResidency-landRecords")
                )
            }
        }
        .navigationTitle("Address & Residency")
        .modifier(ProfileSaveToolbar(hasChanges: $hasChanges, isSaving: $isSaving, onSave: onSave))
    }
}

// MARK: - Identity & Travel Tab

struct IdentityTravelTab: View {
    @Binding var identityInfo: IdentityTravel
    @Binding var hasChanges: Bool
    @Binding var isSaving: Bool
    var onSave: () -> Void
    var fileBinding: (String) -> Binding<URL?>

    var body: some View {
        Form {
            Section("Identity Documents") {
                TextField("National ID card number", text: Binding(
                    get: { identityInfo.idCard ?? "" },
                    set: { identityInfo.idCard = $0; hasChanges = true }
                ))
                TextField("Passport details", text: Binding(
                    get: { identityInfo.passport ?? "" },
                    set: { identityInfo.passport = $0; hasChanges = true }
                ))
                TextField("Driver's license", text: Binding(
                    get: { identityInfo.driversLicense ?? "" },
                    set: { identityInfo.driversLicense = $0; hasChanges = true }
                ))
                TextField("Voter ID", text: Binding(
                    get: { identityInfo.voterId ?? "" },
                    set: { identityInfo.voterId = $0; hasChanges = true }
                ))
                TextField("Social Security / National Insurance Number", text: Binding(
                    get: { identityInfo.ssn ?? "" },
                    set: { identityInfo.ssn = $0; hasChanges = true }
                ))
            }
            Section("Records") {
                ProfileFileUploadField(
                    label: "Military service records",
                    filename: Binding(get: { identityInfo.militaryRecords ?? "" }, set: { identityInfo.militaryRecords = $0; hasChanges = true }),
                    fileURL: fileBinding("identityTravel-militaryRecords")
                )
            }
        }
        .navigationTitle("Identity & Travel")
        .modifier(ProfileSaveToolbar(hasChanges: $hasChanges, isSaving: $isSaving, onSave: onSave))
    }
}

// MARK: - Health & Medical Tab

struct HealthMedicalTab: View {
    @Binding var healthInfo: HealthMedical
    @Binding var hasChanges: Bool
    @Binding var isSaving: Bool
    var onSave: () -> Void
    var fileBinding: (String) -> Binding<URL?>

    var body: some View {
        Form {
            Section("General") {
                TextField("Medical history and health conditions", text: Binding(
                    get: { healthInfo.medicalHistory ?? "" },
                    set: { healthInfo.medicalHistory = $0; hasChanges = true }
                ), axis: .vertical)
                .lineLimit(3...6)
                Picker("Blood Type", selection: Binding(
                    get: { healthInfo.bloodType ?? "" },
                    set: { healthInfo.bloodType = $0; hasChanges = true }
                )) {
                    Text("Please select").tag("")
                    Text("A+").tag("aPositive")
                    Text("A-").tag("aNegative")
                    Text("B+").tag("bPositive")
                    Text("B-").tag("bNegative")
                    Text("AB+").tag("abPositive")
                    Text("AB-").tag("abNegative")
                    Text("O+").tag("oPositive")
                    Text("O-").tag("oNegative")
                    Text("Unknown").tag("unknown")
                }
                TextField("Disability status", text: Binding(
                    get: { healthInfo.disability ?? "" },
                    set: { healthInfo.disability = $0; hasChanges = true }
                ))
                TextField("Organ donor status", text: Binding(
                    get: { healthInfo.organDonor ?? "" },
                    set: { healthInfo.organDonor = $0; hasChanges = true }
                ))
            }
            Section("Insurance & Records") {
                TextField("Health insurance details", text: Binding(
                    get: { healthInfo.insuranceDetails ?? "" },
                    set: { healthInfo.insuranceDetails = $0; hasChanges = true }
                ))
                ProfileFileUploadField(
                    label: "Vaccination records",
                    filename: Binding(get: { healthInfo.vaccinations ?? "" }, set: { healthInfo.vaccinations = $0; hasChanges = true }),
                    fileURL: fileBinding("healthMedical-vaccinations")
                )
            }
            Section("Treatment History") {
                TextField("Prescriptions and treatments received", text: Binding(
                    get: { healthInfo.prescriptions ?? "" },
                    set: { healthInfo.prescriptions = $0; hasChanges = true }
                ), axis: .vertical)
                .lineLimit(3...6)
                TextField("Mental health history", text: Binding(
                    get: { healthInfo.mentalHealth ?? "" },
                    set: { healthInfo.mentalHealth = $0; hasChanges = true }
                ), axis: .vertical)
                .lineLimit(3...6)
            }
        }
        .navigationTitle("Health & Medical")
        .modifier(ProfileSaveToolbar(hasChanges: $hasChanges, isSaving: $isSaving, onSave: onSave))
    }
}

// MARK: - Employment Tab

struct EmploymentTab: View {
    @Binding var employmentInfo: Employment
    @Binding var hasChanges: Bool
    @Binding var isSaving: Bool
    var onSave: () -> Void
    var fileBinding: (String) -> Binding<URL?>

    var body: some View {
        Form {
            Section("Employment") {
                TextField("Current employer details", text: Binding(
                    get: { employmentInfo.currentEmployer ?? "" },
                    set: { employmentInfo.currentEmployer = $0; hasChanges = true }
                ))
                TextField("Employment history", text: Binding(
                    get: { employmentInfo.eHistory ?? "" },
                    set: { employmentInfo.eHistory = $0; hasChanges = true }
                ), axis: .vertical)
                .lineLimit(3...6)
                TextField("Unemployment status and benefits received", text: Binding(
                    get: { employmentInfo.unemployment ?? "" },
                    set: { employmentInfo.unemployment = $0; hasChanges = true }
                ))
            }
            Section("Business & Tax") {
                TextField("Taxpayer identification number (TIN)", text: Binding(
                    get: { employmentInfo.tin ?? "" },
                    set: { employmentInfo.tin = $0; hasChanges = true }
                ))
                TextField("Business ownership and company affiliations", text: Binding(
                    get: { employmentInfo.businessAffiliations ?? "" },
                    set: { employmentInfo.businessAffiliations = $0; hasChanges = true }
                ))
            }
            Section("Documents") {
                ProfileFileUploadField(
                    label: "Work permits and labor contracts",
                    filename: Binding(get: { employmentInfo.workPermits ?? "" }, set: { employmentInfo.workPermits = $0; hasChanges = true }),
                    fileURL: fileBinding("employment-workPermits")
                )
                ProfileFileUploadField(
                    label: "Professional certifications and licenses",
                    filename: Binding(get: { employmentInfo.certifications ?? "" }, set: { employmentInfo.certifications = $0; hasChanges = true }),
                    fileURL: fileBinding("employment-certifications")
                )
            }
        }
        .navigationTitle("Employment & Economic")
        .modifier(ProfileSaveToolbar(hasChanges: $hasChanges, isSaving: $isSaving, onSave: onSave))
    }
}

// MARK: - Education Tab

struct EducationTab: View {
    @Binding var educationInfo: Education
    @Binding var hasChanges: Bool
    @Binding var isSaving: Bool
    var onSave: () -> Void

    var body: some View {
        Form {
            Section("Academic Background") {
                TextField("School and university attended", text: Binding(
                    get: { educationInfo.schools ?? "" },
                    set: { educationInfo.schools = $0; hasChanges = true }
                ), axis: .vertical)
                .lineLimit(3...6)
                TextField("Diplomas, degrees, and certifications", text: Binding(
                    get: { educationInfo.diplomas ?? "" },
                    set: { educationInfo.diplomas = $0; hasChanges = true }
                ))
                TextField("Academic performance and test scores", text: Binding(
                    get: { educationInfo.performance ?? "" },
                    set: { educationInfo.performance = $0; hasChanges = true }
                ))
            }
            Section("Financial Aid") {
                TextField("Scholarships and financial aid received", text: Binding(
                    get: { educationInfo.scholarships ?? "" },
                    set: { educationInfo.scholarships = $0; hasChanges = true }
                ))
            }
        }
        .navigationTitle("Education & Academic")
        .modifier(ProfileSaveToolbar(hasChanges: $hasChanges, isSaving: $isSaving, onSave: onSave))
    }
}

// MARK: - Financial & Tax Tab

struct FinancialTaxTab: View {
    @Binding var financialInfo: FinancialTax
    @Binding var hasChanges: Bool
    @Binding var isSaving: Bool
    var onSave: () -> Void
    var fileBinding: (String) -> Binding<URL?>

    var body: some View {
        Form {
            Section("Accounts") {
                TextField("Banking and financial accounts", text: Binding(
                    get: { financialInfo.bankAccounts ?? "" },
                    set: { financialInfo.bankAccounts = $0; hasChanges = true }
                ))
            }
            Section("Tax & Financial Documents") {
                ProfileFileUploadField(
                    label: "Income tax records",
                    filename: Binding(get: { financialInfo.incomeTax ?? "" }, set: { financialInfo.incomeTax = $0; hasChanges = true }),
                    fileURL: fileBinding("financialTax-incomeTax")
                )
                ProfileFileUploadField(
                    label: "Property tax payments",
                    filename: Binding(get: { financialInfo.propertyTax ?? "" }, set: { financialInfo.propertyTax = $0; hasChanges = true }),
                    fileURL: fileBinding("financialTax-propertyTax")
                )
                ProfileFileUploadField(
                    label: "Business tax filings",
                    filename: Binding(get: { financialInfo.businessTax ?? "" }, set: { financialInfo.businessTax = $0; hasChanges = true }),
                    fileURL: fileBinding("financialTax-businessTax")
                )
                ProfileFileUploadField(
                    label: "Pension contributions and withdrawals",
                    filename: Binding(get: { financialInfo.pensionContrib ?? "" }, set: { financialInfo.pensionContrib = $0; hasChanges = true }),
                    fileURL: fileBinding("financialTax-pensionContrib")
                )
                ProfileFileUploadField(
                    label: "Loan and government aid records",
                    filename: Binding(get: { financialInfo.loanAid ?? "" }, set: { financialInfo.loanAid = $0; hasChanges = true }),
                    fileURL: fileBinding("financialTax-loanAid")
                )
            }
        }
        .navigationTitle("Financial & Tax")
        .modifier(ProfileSaveToolbar(hasChanges: $hasChanges, isSaving: $isSaving, onSave: onSave))
    }
}

// MARK: - Social Security Tab

struct SocialSecurityTab: View {
    @Binding var socialInfo: SocialSecurity
    @Binding var hasChanges: Bool
    @Binding var isSaving: Bool
    var onSave: () -> Void

    var body: some View {
        Form {
            Section("Benefits & Contributions") {
                TextField("Pension status and contributions", text: Binding(
                    get: { socialInfo.pensionStatus ?? "" },
                    set: { socialInfo.pensionStatus = $0; hasChanges = true }
                ))
                TextField("Unemployment status and benefits received", text: Binding(
                    get: { socialInfo.unemployment ?? "" },
                    set: { socialInfo.unemployment = $0; hasChanges = true }
                ))
                TextField("Disability status", text: Binding(
                    get: { socialInfo.disability ?? "" },
                    set: { socialInfo.disability = $0; hasChanges = true }
                ))
            }
            Section("Assistance Programs") {
                TextField("Childcare support", text: Binding(
                    get: { socialInfo.childcare ?? "" },
                    set: { socialInfo.childcare = $0; hasChanges = true }
                ))
                TextField("Food assistance / welfare programs", text: Binding(
                    get: { socialInfo.foodAssistance ?? "" },
                    set: { socialInfo.foodAssistance = $0; hasChanges = true }
                ))
                TextField("Housing assistance", text: Binding(
                    get: { socialInfo.housingAssistance ?? "" },
                    set: { socialInfo.housingAssistance = $0; hasChanges = true }
                ))
            }
        }
        .navigationTitle("Social Security & Welfare")
        .modifier(ProfileSaveToolbar(hasChanges: $hasChanges, isSaving: $isSaving, onSave: onSave))
    }
}

// MARK: - Criminal & Legal Tab

struct CriminalLegalTab: View {
    @Binding var criminalInfo: CriminalLegal
    @Binding var hasChanges: Bool
    @Binding var isSaving: Bool
    var onSave: () -> Void
    var fileBinding: (String) -> Binding<URL?>

    var body: some View {
        Form {
            Section("Records & Documents") {
                ProfileFileUploadField(
                    label: "Police records (criminal history, arrests, charges)",
                    filename: Binding(get: { criminalInfo.policeRecords ?? "" }, set: { criminalInfo.policeRecords = $0; hasChanges = true }),
                    fileURL: fileBinding("criminalLegal-policeRecords")
                )
                ProfileFileUploadField(
                    label: "Court case history",
                    filename: Binding(get: { criminalInfo.courtCases ?? "" }, set: { criminalInfo.courtCases = $0; hasChanges = true }),
                    fileURL: fileBinding("criminalLegal-courtCases")
                )
                ProfileFileUploadField(
                    label: "Fines and penalties",
                    filename: Binding(get: { criminalInfo.finesPenalties ?? "" }, set: { criminalInfo.finesPenalties = $0; hasChanges = true }),
                    fileURL: fileBinding("criminalLegal-finesPenalties")
                )
            }
            Section("Status") {
                TextField("Parole or probation status", text: Binding(
                    get: { criminalInfo.paroleProbation ?? "" },
                    set: { criminalInfo.paroleProbation = $0; hasChanges = true }
                ))
                TextField("Citizenship revocation (if applicable)", text: Binding(
                    get: { criminalInfo.citizenshipRevocation ?? "" },
                    set: { criminalInfo.citizenshipRevocation = $0; hasChanges = true }
                ))
            }
        }
        .navigationTitle("Criminal & Legal")
        .modifier(ProfileSaveToolbar(hasChanges: $hasChanges, isSaving: $isSaving, onSave: onSave))
    }
}

// MARK: - Transportation Tab

struct TransportationTab: View {
    @Binding var transportInfo: Transportation
    @Binding var hasChanges: Bool
    @Binding var isSaving: Bool
    var onSave: () -> Void
    var fileBinding: (String) -> Binding<URL?>

    var body: some View {
        Form {
            Section("Vehicles & Licenses") {
                TextField("Vehicle registration details", text: Binding(
                    get: { transportInfo.vehicleReg ?? "" },
                    set: { transportInfo.vehicleReg = $0; hasChanges = true }
                ))
                TextField("Driving license history and endorsements", text: Binding(
                    get: { transportInfo.licenseHistory ?? "" },
                    set: { transportInfo.licenseHistory = $0; hasChanges = true }
                ))
                TextField("Public transport card usage", text: Binding(
                    get: { transportInfo.publicTransportCard ?? "" },
                    set: { transportInfo.publicTransportCard = $0; hasChanges = true }
                ))
            }
            Section("Records") {
                ProfileFileUploadField(
                    label: "Traffic violations and fines",
                    filename: Binding(get: { transportInfo.trafficViolations ?? "" }, set: { transportInfo.trafficViolations = $0; hasChanges = true }),
                    fileURL: fileBinding("transportation-trafficViolations")
                )
            }
        }
        .navigationTitle("Transportation & Mobility")
        .modifier(ProfileSaveToolbar(hasChanges: $hasChanges, isSaving: $isSaving, onSave: onSave))
    }
}

// MARK: - Civic & Political Participation Tab

struct CivicParticipationTab: View {
    @Binding var civicInfo: CivicParticipation
    @Binding var hasChanges: Bool
    @Binding var isSaving: Bool
    var onSave: () -> Void

    var body: some View {
        Form {
            Section("Electoral") {
                TextField("Voter registration details", text: Binding(
                    get: { civicInfo.voterRegistration ?? "" },
                    set: { civicInfo.voterRegistration = $0; hasChanges = true }
                ))
                TextField("Election participation history", text: Binding(
                    get: { civicInfo.electionHistory ?? "" },
                    set: { civicInfo.electionHistory = $0; hasChanges = true }
                ))
                TextField("Political party membership", text: Binding(
                    get: { civicInfo.partyMembership ?? "" },
                    set: { civicInfo.partyMembership = $0; hasChanges = true }
                ))
            }
            Section("Service") {
                TextField("Military service or conscription status", text: Binding(
                    get: { civicInfo.militaryStatus ?? "" },
                    set: { civicInfo.militaryStatus = $0; hasChanges = true }
                ))
                TextField("Public service roles", text: Binding(
                    get: { civicInfo.publicServiceRoles ?? "" },
                    set: { civicInfo.publicServiceRoles = $0; hasChanges = true }
                ))
            }
        }
        .navigationTitle("Civic & Political")
        .modifier(ProfileSaveToolbar(hasChanges: $hasChanges, isSaving: $isSaving, onSave: onSave))
    }
}

// MARK: - Profile File Upload Field

struct ProfileFileUploadField: View {
    @Environment(ThemeManager.self) private var theme

    let label: String
    @Binding var filename: String
    @Binding var fileURL: URL?

    @State private var showFilePicker = false

    var body: some View {
        Button(action: { showFilePicker = true }) {
            HStack {
                Image(systemName: "doc.badge.arrow.up")
                    .foregroundColor(theme.primaryColor)
                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .font(.subheadline)
                        .foregroundColor(theme.primaryTextColor)
                    if !filename.isEmpty {
                        Text(filename)
                            .font(.caption)
                            .foregroundColor(theme.secondaryTextColor)
                    }
                }
                Spacer()
                if filename.isEmpty {
                    Text("Upload")
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)
                } else {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                }
            }
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

// MARK: - Date Picker Field

struct ProfileDateField: View {
    @Binding var dateString: String

    @State private var selectedDate = Date()
    @State private var hasPickedDate = false

    private static let displayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    var body: some View {
        DatePicker(
            "Date of birth",
            selection: $selectedDate,
            in: ...Date(),
            displayedComponents: .date
        )
        .onChange(of: selectedDate) { _, newValue in
            dateString = Self.displayFormatter.string(from: newValue)
        }
        .onAppear {
            if !dateString.isEmpty, let parsed = Self.displayFormatter.date(from: dateString) {
                selectedDate = parsed
            }
        }
    }
}

// MARK: - Country Picker Field

struct ProfileCountryPickerField: View {
    @Environment(ThemeManager.self) private var theme

    @Binding var selection: String

    @State private var showCountryPicker = false

    var body: some View {
        Button(action: { showCountryPicker = true }) {
            HStack {
                Text(selection.isEmpty
                     ? String(localized: "Select a country")
                     : selection)
                    .foregroundColor(selection.isEmpty ? theme.secondaryTextColor : theme.primaryTextColor)
                Spacer()
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption)
                    .foregroundColor(theme.secondaryTextColor)
            }
        }
        .sheet(isPresented: $showCountryPicker) {
            CountryPickerSheet(selection: $selection)
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
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .accessibilityLabel(Text("Close"))
                }
            }
        }
    }

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
