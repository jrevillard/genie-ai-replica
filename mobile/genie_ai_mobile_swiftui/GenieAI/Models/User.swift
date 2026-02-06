// User.swift
// User model for authentication and profile data

import Foundation

struct User: Codable, Identifiable, Equatable {
    let id: String
    var loginName: String
    var email: String
    var emailVerified: Bool?
    var displayName: String?
    var profileImageUrl: String?
    var role: String?
    var createdAt: String?
    var updatedAt: String?

    // Profile data (matches API nested objects)
    var personalIdentification: PersonalIdentification?
    var civilRegistration: CivilRegistration?
    var addressResidency: AddressResidency?
    var identityTravel: IdentityTravel?
    var healthMedical: HealthMedical?
    var employment: Employment?
    var education: Education?
    var financialTax: FinancialTax?
    var socialSecurity: SocialSecurity?
    var criminalLegal: CriminalLegal?
    var transportation: Transportation?
    var civicParticipation: CivicParticipation?

    private enum CodingKeys: String, CodingKey {
        case underscoreId = "_id"
        case underscoreKey = "_key"
        case plainId = "id"
        case loginName
        case email
        case emailVerified
        case displayName
        case profileImageUrl
        case role
        case createdAt
        case updatedAt
        case personalIdentification
        case civilRegistration
        case addressResidency
        case identityTravel
        case healthMedical
        case employment
        case education
        case financialTax
        case socialSecurity
        case criminalLegal
        case transportation
        case civicParticipation
    }

    init(
        id: String,
        loginName: String,
        email: String,
        emailVerified: Bool? = nil,
        displayName: String? = nil,
        profileImageUrl: String? = nil,
        role: String? = nil,
        createdAt: String? = nil,
        updatedAt: String? = nil,
        personalIdentification: PersonalIdentification? = nil,
        civilRegistration: CivilRegistration? = nil,
        addressResidency: AddressResidency? = nil,
        identityTravel: IdentityTravel? = nil,
        healthMedical: HealthMedical? = nil,
        employment: Employment? = nil,
        education: Education? = nil,
        financialTax: FinancialTax? = nil,
        socialSecurity: SocialSecurity? = nil,
        criminalLegal: CriminalLegal? = nil,
        transportation: Transportation? = nil,
        civicParticipation: CivicParticipation? = nil
    ) {
        self.id = id
        self.loginName = loginName
        self.email = email
        self.emailVerified = emailVerified
        self.displayName = displayName
        self.profileImageUrl = profileImageUrl
        self.role = role
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.personalIdentification = personalIdentification
        self.civilRegistration = civilRegistration
        self.addressResidency = addressResidency
        self.identityTravel = identityTravel
        self.healthMedical = healthMedical
        self.employment = employment
        self.education = education
        self.financialTax = financialTax
        self.socialSecurity = socialSecurity
        self.criminalLegal = criminalLegal
        self.transportation = transportation
        self.civicParticipation = civicParticipation
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Flutter: userData['_key'] ?? userData['id']
        if let key = try container.decodeIfPresent(String.self, forKey: .underscoreKey) {
            self.id = key
        } else if let uid = try container.decodeIfPresent(String.self, forKey: .underscoreId) {
            self.id = uid
        } else if let pid = try container.decodeIfPresent(String.self, forKey: .plainId) {
            self.id = pid
        } else {
            self.id = UUID().uuidString
        }

        self.loginName = try container.decodeIfPresent(String.self, forKey: .loginName) ?? ""
        self.email = try container.decodeIfPresent(String.self, forKey: .email) ?? ""
        self.emailVerified = try container.decodeIfPresent(Bool.self, forKey: .emailVerified)
        self.displayName = try container.decodeIfPresent(String.self, forKey: .displayName)
        self.profileImageUrl = try container.decodeIfPresent(String.self, forKey: .profileImageUrl)
        self.role = try container.decodeIfPresent(String.self, forKey: .role)
        self.createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        self.updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
        self.personalIdentification = try container.decodeIfPresent(PersonalIdentification.self, forKey: .personalIdentification)
        self.civilRegistration = try container.decodeIfPresent(CivilRegistration.self, forKey: .civilRegistration)
        self.addressResidency = try container.decodeIfPresent(AddressResidency.self, forKey: .addressResidency)
        self.identityTravel = try container.decodeIfPresent(IdentityTravel.self, forKey: .identityTravel)
        self.healthMedical = try container.decodeIfPresent(HealthMedical.self, forKey: .healthMedical)
        self.employment = try container.decodeIfPresent(Employment.self, forKey: .employment)
        self.education = try container.decodeIfPresent(Education.self, forKey: .education)
        self.financialTax = try container.decodeIfPresent(FinancialTax.self, forKey: .financialTax)
        self.socialSecurity = try container.decodeIfPresent(SocialSecurity.self, forKey: .socialSecurity)
        self.criminalLegal = try container.decodeIfPresent(CriminalLegal.self, forKey: .criminalLegal)
        self.transportation = try container.decodeIfPresent(Transportation.self, forKey: .transportation)
        self.civicParticipation = try container.decodeIfPresent(CivicParticipation.self, forKey: .civicParticipation)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .underscoreId)
        try container.encode(loginName, forKey: .loginName)
        try container.encode(email, forKey: .email)
        try container.encodeIfPresent(emailVerified, forKey: .emailVerified)
        try container.encodeIfPresent(displayName, forKey: .displayName)
        try container.encodeIfPresent(profileImageUrl, forKey: .profileImageUrl)
        try container.encodeIfPresent(role, forKey: .role)
        try container.encodeIfPresent(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
        try container.encodeIfPresent(personalIdentification, forKey: .personalIdentification)
        try container.encodeIfPresent(civilRegistration, forKey: .civilRegistration)
        try container.encodeIfPresent(addressResidency, forKey: .addressResidency)
        try container.encodeIfPresent(identityTravel, forKey: .identityTravel)
        try container.encodeIfPresent(healthMedical, forKey: .healthMedical)
        try container.encodeIfPresent(employment, forKey: .employment)
        try container.encodeIfPresent(education, forKey: .education)
        try container.encodeIfPresent(financialTax, forKey: .financialTax)
        try container.encodeIfPresent(socialSecurity, forKey: .socialSecurity)
        try container.encodeIfPresent(criminalLegal, forKey: .criminalLegal)
        try container.encodeIfPresent(transportation, forKey: .transportation)
        try container.encodeIfPresent(civicParticipation, forKey: .civicParticipation)
    }

    static func == (lhs: User, rhs: User) -> Bool {
        lhs.id == rhs.id
    }
}

struct PersonalIdentification: Codable {
    var fullName: String?
    var dob: String?
    var gender: String?
    var nationality: String?
    var maritalStatus: String?
    var profileIcon: String?
}

struct CivilRegistration: Codable {
    var birthCert: String?
    var deathCert: String?
    var marriageDivorce: String?
    var adoption: String?
    var citizenship: String?
    var immigration: String?
}

struct AddressResidency: Codable {
    var currentAddress: String?
    var previousAddresses: String?
    var homeOrRental: String?
    var utilityBills: String?
    var landRecords: String?
}

struct IdentityTravel: Codable {
    var idCard: String?
    var passport: String?
    var driversLicense: String?
    var voterId: String?
    var ssn: String?
    var militaryRecords: String?
}

struct HealthMedical: Codable {
    var medicalHistory: String?
    var vaccinations: String?
    var insuranceDetails: String?
    var bloodType: String?
    var disability: String?
    var organDonor: String?
    var prescriptions: String?
    var mentalHealth: String?
}

struct Employment: Codable {
    var eHistory: String?
    var currentEmployer: String?
    var workPermits: String?
    var certifications: String?
    var unemployment: String?
    var tin: String?
    var businessAffiliations: String?
}

struct Education: Codable {
    var schools: String?
    var diplomas: String?
    var performance: String?
    var scholarships: String?
}

struct FinancialTax: Codable {
    var incomeTax: String?
    var bankAccounts: String?
    var propertyTax: String?
    var businessTax: String?
    var pensionContrib: String?
    var loanAid: String?
}

struct SocialSecurity: Codable {
    var pensionStatus: String?
    var unemployment: String?
    var disability: String?
    var childcare: String?
    var foodAssistance: String?
    var housingAssistance: String?
}

struct CriminalLegal: Codable {
    var policeRecords: String?
    var courtCases: String?
    var finesPenalties: String?
    var paroleProbation: String?
    var citizenshipRevocation: String?
}

struct Transportation: Codable {
    var vehicleReg: String?
    var trafficViolations: String?
    var licenseHistory: String?
    var publicTransportCard: String?
}

struct CivicParticipation: Codable {
    var voterRegistration: String?
    var electionHistory: String?
    var partyMembership: String?
    var militaryStatus: String?
    var publicServiceRoles: String?
}

// Authentication response from the API
struct AuthResponse: Codable {
    let accessToken: String
    let refreshToken: String?
    let user: User?
    let expiresIn: Int?

    enum CodingKeys: String, CodingKey {
        case accessToken
        case refreshToken
        case user
        case expiresIn
    }
}

// Login request payload
struct LoginRequest: Codable {
    let loginName: String
    let encPassword: String
}

// Register request payload
struct RegisterRequest: Codable {
    let username: String
    let email: String
    let encPassword: String
}
