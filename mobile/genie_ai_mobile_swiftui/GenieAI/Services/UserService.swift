// UserService.swift
// Service for user profile and account management

import Foundation

@Observable
class UserService {
    private let api = APIService.shared

    private(set) var isLoading = false
    private(set) var error: String?

    // MARK: - Profile

    func getProfile(userId: String) async throws -> User {
        let data = try await api.get("users/\(userId)")
        return try JSONDecoder.withFlexibleDates().decode(User.self, from: data)
    }

    func updateProfile(
        userId: String,
        personalIdentification: PersonalIdentification,
        addressResidency: AddressResidency
    ) async throws -> User {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let encoder = JSONEncoder()

        let personalData = try encoder.encode(personalIdentification)
        let personalDict = try JSONSerialization.jsonObject(with: personalData) as? [String: Any] ?? [:]

        let addressData = try encoder.encode(addressResidency)
        let addressDict = try JSONSerialization.jsonObject(with: addressData) as? [String: Any] ?? [:]

        let data = try await api.put("users/\(userId)", data: [
            "personalIdentification": personalDict,
            "addressResidency": addressDict
        ])
        return try JSONDecoder.withFlexibleDates().decode(User.self, from: data)
    }

    // MARK: - Account Settings

    func updateAccountSettings(userId: String, settings: [String: Any]) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let _ = try await api.put("users/\(userId)", data: settings)
    }

    func updateEmail(userId: String, newEmail: String, password: String) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let hashedPassword = password.sha256

        let _ = try await api.put("users/email", data: [
            "email": newEmail,
            "password": hashedPassword,
            "userId": userId
        ])
    }

    func resetUserData(userId: String) async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let _ = try await api.post("users/reset-data", data: ["userId": userId])
    }

    func deleteAccount(password: String, reason: String = "") async throws {
        isLoading = true
        error = nil

        defer { isLoading = false }

        let hashedPassword = password.sha256

        let _ = try await api.post("users/delete", data: [
            "password": hashedPassword,
            "reason": reason
        ])
    }

    // MARK: - Availability Checks

    func checkUsernameAvailability(_ username: String) async throws -> Bool {
        let data = try await api.get("users/check-username", params: ["username": username])

        struct Response: Codable {
            let available: Bool
        }

        let response = try JSONDecoder.withFlexibleDates().decode(Response.self, from: data)
        return response.available
    }

    func checkEmailAvailability(_ email: String) async throws -> Bool {
        let data = try await api.get("users/check-email", params: ["email": email])

        struct Response: Codable {
            let available: Bool
        }

        let response = try JSONDecoder.withFlexibleDates().decode(Response.self, from: data)
        return response.available
    }
}
