// User.swift
// User model for authentication and profile data

import Foundation

struct User: Codable, Identifiable, Equatable {
    let id: String
    var username: String
    var email: String
    var displayName: String?
    var profileImageUrl: String?
    var role: String?
    var isVerified: Bool?
    var createdAt: Date?
    var updatedAt: Date?

    // Profile data
    var profile: UserProfile?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case username
        case email
        case displayName
        case profileImageUrl
        case role
        case isVerified
        case createdAt
        case updatedAt
        case profile
    }

    init(
        id: String,
        username: String,
        email: String,
        displayName: String? = nil,
        profileImageUrl: String? = nil,
        role: String? = nil,
        isVerified: Bool? = nil,
        createdAt: Date? = nil,
        updatedAt: Date? = nil,
        profile: UserProfile? = nil
    ) {
        self.id = id
        self.username = username
        self.email = email
        self.displayName = displayName
        self.profileImageUrl = profileImageUrl
        self.role = role
        self.isVerified = isVerified
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.profile = profile
    }

    static func == (lhs: User, rhs: User) -> Bool {
        lhs.id == rhs.id
    }
}

struct UserProfile: Codable {
    var fullName: String?
    var dateOfBirth: Date?
    var gender: String?
    var nationality: String?
    var maritalStatus: String?
    var currentAddress: String?
    var postalCode: String?
    var country: String?
    var residencyStatus: String?
    var nationalIdNumber: String?
    var passportNumber: String?
    var driversLicense: String?
    var bloodType: String?

    enum CodingKeys: String, CodingKey {
        case fullName
        case dateOfBirth
        case gender
        case nationality
        case maritalStatus
        case currentAddress
        case postalCode
        case country
        case residencyStatus
        case nationalIdNumber
        case passportNumber
        case driversLicense
        case bloodType
    }
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
