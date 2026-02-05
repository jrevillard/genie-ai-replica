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

    enum CodingKeys: String, CodingKey {
        case id = "_id"
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
