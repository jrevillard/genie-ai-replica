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
    var addressResidency: AddressResidency?

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
        case addressResidency
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
        addressResidency: AddressResidency? = nil
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
        self.addressResidency = addressResidency
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
        self.addressResidency = try container.decodeIfPresent(AddressResidency.self, forKey: .addressResidency)
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
        try container.encodeIfPresent(addressResidency, forKey: .addressResidency)
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

struct AddressResidency: Codable {
    var currentAddress: String?
    var previousAddresses: String?
    var homeOrRental: String?
    var utilityBills: String?
    var landRecords: String?
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
